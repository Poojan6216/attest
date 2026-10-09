/**
 * The observer base (sprint_2 2.0; build_spec §7 adapter contract; agents/adapter_engineer.md "Pattern"): the
 * standard content-script skeleton every Gmail and Calendar observer runs.
 *
 *   health() → extract() → redact.project() → bus
 *
 * A content script does nothing but `startObservers(observers)`. Each pass reads the clock once (src/clock.ts) and
 * decides what it may report (./plan.ts), then posts, in this order and one message at a time, each only after the
 * previous one was answered:
 *  1. `adapter.health`: OK; IDLE with reason codes when the page is not one the observer reads (another Gmail folder,
 *     no conversation open: nothing else is posted, and the ledger keeps the status a page it reads gave, sprint_2
 *     2.11); or DEGRADED with reason codes (Hard Rule 6: every pass reports its health);
 *  2. `observer.observations`: the rows `project()` accepted, at most SCHEMA_LIMITS.BATCH per message, each with
 *     `observedAt` = the instant the pass read the page (docs/grading.md §3, §10), never `sightedAt`;
 *  3. `coverage.ping`, one per window the pass saw (./coverage.ts), each naming the observer's `source` (and, for
 *     `gcal.event`, `allCalendars`): only for a clean pass whose health was OK. A DEGRADED health, a row `project()`
 *     refused (`RedactError`), an unreadable account, window or calendar list, or a message that failed its schema
 *     posts no coverage for that pass (Hard Rule 5; Sprint 1 close, SEC-3). The account's address never leaves,
 *     only its hash (./account.ts). A clean pass that saw no window by design (a Sent page past the head of the
 *     list, an opened conversation with no receipt, a Calendar grid still drawing) posts none and stays OK;
 *  4. `calendar.snapshot`: the Calendar observer's snapshot of the range it read, after the coverage, only for a
 *     clean pass whose account is known (sprint_2 2.7). The background keeps it as the range's previous snapshot.
 * If a post rejects, the rest of the pass is not sent, so coverage never follows observations that were not
 * stored. The content-script entrypoints pass src/bus `postAcked`, which rejects when the background answers
 * `{ ok: false, code }` (the ledger refused a row: `invalid_input`, `late_sighting`, …) or the message never arrived
 * (sprint_2 2.7). The default, src/bus `send()`, resolves on a transport failure; only tests and the E2E harness rely
 * on it.
 *
 * A content script starts all its observers at once (`startObservers`), with one MutationObserver over the document,
 * one activity tracker and one page-sync tracker (TECH-2). Changes to the tree, the text and the attributes its
 * observers read (./batch.ts `watchedInit`) are batched (debounce OBSERVER_DEBOUNCE_MS, at most OBSERVER_MAX_WAIT_MS)
 * into one request for a pass of each observer, and each observer's passes run one at a time (./serial.ts). The
 * first passes run one debounce after start, or, on a page Chrome prerendered, one debounce after the user opens it
 * (Hard Rule 11: a page the user has not opened is not read). A pass that cannot vouch that the page shows the
 * present (offline, or catching up after it came back: ./lifecycle.ts `trackPageSync`) posts its health and rows but
 * no coverage and no snapshot (Decisions [2.close] S4; Hard Rule 5).
 *
 * The skeleton stops only when the extension context is really gone (Decisions [2.close] S5, SEC-3): a post that
 * rejects with BusError `context_invalidated`, or src/bus `extensionContextAlive()` false when a batch flushes. It
 * never stops on WXT's `ctx.onInvalidated`, which the page itself can fire by dispatching WXT's start-up event.
 * Read-only (Hard Rule 3): nothing here writes the DOM, dispatches an event or reaches the network; `attest/no-act`
 * lints all of src/observers/**.
 */
import { BusError } from '../bus/errors';
import {
  AdapterHealthMessage,
  type BusMessage,
  type BusMessageType,
  CalendarSnapshotMessage,
  CoveragePingMessage,
  ObserverObservationsMessage,
} from '../bus/messages';
import { extensionContextAlive, send } from '../bus/send';
import { nowIso } from '../clock';
import { OBSERVER_DEBOUNCE_MS, OBSERVER_MAX_WAIT_MS } from '../config';
import { instantMs, type OffsetAt } from '../core/normalize';
import { DEFAULT_POLICY } from '../core/policy';
import { IsoTs, type Observation, SCHEMA_LIMITS } from '../core/schema';
import { trackUserActivity } from './activity';
import {
  checkOptions,
  createBatcher,
  SYSTEM_TIMERS,
  type Timers,
  watchedInit,
  watchMutations,
} from './batch';
import { ObserverError } from './errors';
import {
  checkHeartbeat,
  isPrerendering,
  PRERENDERING_CHANGE,
  startHeartbeat,
  trackPageSync,
} from './lifecycle';
import { assertObserver } from './observer-check';
import { type PassPlan, type PassPolicy, planPass } from './plan';
import { type SerialRunner, serialRunner } from './serial';
import { browserOffsetAt } from './time-zone';
import type { Observer } from './types';

export type * from './types';
export { PASS_REASONS, type PassPolicy, type PassReason } from './plan';
export { assertObserver } from './observer-check';
export { browserOffsetAt } from './time-zone';

/** Hands one validated message to the service worker; settles when it was answered. Default: src/bus `send`. */
export type Post = (message: BusMessage) => Promise<unknown>;

/** What a pass needs besides the observer. Every field is injected in tests; `startObserver` fills the defaults. */
export interface PassDeps {
  readonly doc: Document;
  readonly post: Post;
  /** src/clock.ts `nowIso`: ISO 8601 with the local offset. */
  readonly now: () => string;
  readonly offsetAt: OffsetAt;
  readonly policy: PassPolicy;
  /** The coverage ping's user-activity flag at the pass instant (./activity.ts). */
  readonly userActive: () => boolean;
  /**
   * Whether the pass `observerId` read at `atMs` can vouch that the page showed the present (./lifecycle.ts
   * `trackPageSync`; `startObservers` always gives it). False: the pass posts its health and rows, no coverage and no
   * snapshot. Absent: every pass vouches.
   */
  readonly vouches?: ((observerId: string, atMs: number) => boolean) | undefined;
}

/**
 * What one pass did, for tests and the content script's own bookkeeping. Never posted. `clock.invalid` (the clock
 * gave no ISO instant, so nothing could be stamped or sent) appears only here.
 */
export interface PassResult {
  readonly status: 'OK' | 'IDLE' | 'DEGRADED';
  readonly reasons: readonly string[];
  /** The types of the messages posted and answered, in order. */
  readonly posted: readonly BusMessageType[];
  /** False when a post failed and the rest of the pass was not sent. */
  readonly complete: boolean;
}

function healthMessage(observer: Observer, plan: PassPlan, checkedAt: IsoTs): BusMessage | null {
  const named = plan.status === 'DEGRADED' || plan.status === 'IDLE';
  const parsed = AdapterHealthMessage.safeParse({
    type: 'adapter.health',
    health: {
      adapterId: observer.id,
      version: observer.version,
      status: named ? plan.status : 'OK',
      reasons: named ? plan.reasons : [],
      checkedAt,
    },
  });
  return parsed.success ? parsed.data : null;
}

function observationMessages(observer: Observer, observations: readonly Observation[]): BusMessage[] | null {
  const messages: BusMessage[] = [];
  for (let start = 0; start < observations.length; start += SCHEMA_LIMITS.BATCH) {
    const parsed = ObserverObservationsMessage.safeParse({
      type: 'observer.observations',
      observerId: observer.id,
      version: observer.version,
      observations: observations.slice(start, start + SCHEMA_LIMITS.BATCH),
    });
    if (!parsed.success) return null;
    messages.push(parsed.data);
  }
  return messages;
}

/** One `coverage.ping` per window of a clean pass (none for any other), or null when one fails its schema. */
function coverageMessages(
  observer: Observer,
  plan: PassPlan,
  lastSyncAt: IsoTs,
  userActive: boolean,
): BusMessage[] | null {
  if (plan.status !== 'OK') return [];
  const messages: BusMessage[] = [];
  for (const facts of plan.coverage) {
    const parsed = CoveragePingMessage.safeParse({
      type: 'coverage.ping',
      ping: { observerId: observer.id, source: observer.source, lastSyncAt, ...facts, userActive },
    });
    if (!parsed.success) return null;
    messages.push(parsed.data);
  }
  return messages;
}

/** The pass's `calendar.snapshot` (none when the plan has no snapshot), or null when it fails its schema. */
function snapshotMessages(observer: Observer, plan: PassPlan): BusMessage[] | null {
  if (plan.status === 'DEGRADED' || plan.status === 'IDLE' || plan.snapshot === undefined) return [];
  const parsed = CalendarSnapshotMessage.safeParse({
    type: 'calendar.snapshot',
    observerId: observer.id,
    snapshot: plan.snapshot,
  });
  return parsed.success ? [parsed.data] : null;
}

/** A DEGRADED pass that reports only `message.invalid`: a message of this pass failed its bus schema. */
const INVALID_MESSAGE: PassPlan = { status: 'DEGRADED', reasons: ['message.invalid'], observations: [] };

/**
 * The messages one pass posts, in order: health, observations, a ping per window, the snapshot. When any of them
 * fails its bus schema (a bug, never expected), the pass posts only a DEGRADED `message.invalid` health report:
 * nothing it cannot fully report goes out, coverage least of all. Throws only if the observer itself was not
 * checked by `assertObserver`.
 */
export function passMessages(
  observer: Observer,
  plan: PassPlan,
  at: IsoTs,
  userActive: boolean,
): BusMessage[] {
  const health = healthMessage(observer, plan, at);
  const observations = observationMessages(observer, plan.observations);
  const coverage = coverageMessages(observer, plan, at, userActive);
  const snapshot = snapshotMessages(observer, plan);
  if (health !== null && observations !== null && coverage !== null && snapshot !== null) {
    return [health, ...observations, ...coverage, ...snapshot];
  }
  const fallback = healthMessage(observer, INVALID_MESSAGE, at);
  if (fallback === null) throw new ObserverError('invalid_observer');
  return [fallback];
}

function resultOf(messages: readonly BusMessage[], posted: BusMessageType[], complete: boolean): PassResult {
  const [first] = messages;
  const health = first?.type === 'adapter.health' ? first.health : null;
  return {
    status: health?.status ?? 'DEGRADED',
    reasons: health?.reasons ?? [],
    posted,
    complete,
  };
}

/**
 * The plan of a pass that cannot vouch that the page shows the present (./lifecycle.ts): its health and its rows, no
 * coverage and no snapshot. An IDLE or DEGRADED plan posts neither anyway.
 */
function withoutCoverage(plan: PassPlan): PassPlan {
  if (plan.status === 'DEGRADED' || plan.status === 'IDLE') return plan;
  return { status: 'OK_NO_COVERAGE', observations: plan.observations };
}

/**
 * One pass: read the clock once, decide (./plan.ts), post each message after the previous one was answered.
 * Resolves what it did; never rejects. A post that rejects ends the pass: nothing after it is sent.
 */
export async function runPass(observer: Observer, deps: PassDeps): Promise<PassResult> {
  const clock = IsoTs.safeParse(deps.now());
  // Without a valid instant no health report can be stamped; src/clock.ts never gets here.
  if (!clock.success) return { status: 'DEGRADED', reasons: ['clock.invalid'], posted: [], complete: false };
  const observedAt = clock.data;
  const ctx = { observedAt, offsetAt: deps.offsetAt };
  const planned = planPass({ observer, doc: deps.doc, ctx, policy: deps.policy });
  const vouches = deps.vouches?.(observer.id, instantMs(observedAt)) ?? true;
  const plan = vouches ? planned : withoutCoverage(planned);
  const messages = passMessages(observer, plan, observedAt, deps.userActive());
  const posted: BusMessageType[] = [];
  for (const message of messages) {
    try {
      await deps.post(message);
    } catch {
      return resultOf(messages, posted, false);
    }
    posted.push(message.type);
  }
  return resultOf(messages, posted, true);
}

/** Everything `startObservers` can be given; each has a production default. */
export interface StartOptions extends PassDeps {
  readonly view: Window;
  readonly timers: Timers;
  readonly Watcher: typeof MutationObserver;
  readonly debounceMs: number;
  readonly maxWaitMs: number;
  /**
   * Read the page again this often while it is visible, even when nothing in it changed, and as soon as it becomes
   * visible again (null: only on changes). The Calendar observer uses OBSERVER_HEARTBEAT_MS so the snapshot a change is
   * compared with is never older than the attribution bound (docs/grading.md §3, §7).
   */
  readonly heartbeatMs: number | null;
  /** Whether this content script can still reach the extension (src/bus `extensionContextAlive`). */
  readonly contextAlive: () => boolean;
}

export interface ObserverHandle {
  /** Stops watching: no pass starts after this (a running one finishes). Listeners and timers are removed. */
  readonly disconnect: () => void;
  /** Settles when no pass is running or due. */
  readonly settled: () => Promise<void>;
}

function startOptions(overrides: Partial<StartOptions>): Omit<StartOptions, 'userActive' | 'vouches'> {
  return {
    doc: overrides.doc ?? document,
    view: overrides.view ?? window,
    post: overrides.post ?? send,
    now: overrides.now ?? nowIso,
    offsetAt: overrides.offsetAt ?? browserOffsetAt,
    policy: overrides.policy ?? DEFAULT_POLICY,
    timers: overrides.timers ?? SYSTEM_TIMERS,
    Watcher: overrides.Watcher ?? MutationObserver,
    debounceMs: overrides.debounceMs ?? OBSERVER_DEBOUNCE_MS,
    maxWaitMs: overrides.maxWaitMs ?? OBSERVER_MAX_WAIT_MS,
    heartbeatMs: overrides.heartbeatMs ?? null,
    contextAlive: overrides.contextAlive ?? extensionContextAlive,
  };
}

/**
 * A post rejected for good: this content script lost its extension (reloaded, updated or removed under the page), or
 * the person turned its page reader off (sprint_4 4.5: the service worker answered `reader_off`).
 */
const stopsForGood = (error: unknown): boolean =>
  error instanceof BusError && (error.code === 'context_invalidated' || error.code === 'reader_off');

/** `post`, calling `stop` when it rejects for good (`stopsForGood`, or no context); the rejection still ends the pass. */
function stoppingWhenGone(post: Post, contextAlive: () => boolean, stop: () => void): Post {
  return async (message) => {
    try {
      return await post(message);
    } catch (error) {
      if (stopsForGood(error) || !contextAlive()) stop();
      throw error;
    }
  };
}

/** What the skeleton runs passes for: an observer, or an agent adapter (src/adapters/base.ts). */
export interface PassTarget {
  /** The attributes its reads depend on (`Observer.attributes`); absent, every attribute is watched. */
  readonly attributes?: readonly string[] | undefined;
}

/**
 * Starts the skeleton for a content script's `targets` on this page (see the module comment): one watcher, one
 * activity tracker, one page-sync tracker and one heartbeat for all of them, and one serial runner each, whose passes
 * are `runOne(target, deps)`. The first passes run one debounce after start; a prerendered page runs none until the
 * user opens it. Throws `ObserverError` for invalid options, before it attaches any listener; the targets are the
 * caller's to check (`startObservers`, src/adapters/base.ts `startAdapters`).
 */
export function startPasses<T extends PassTarget>(
  targets: readonly T[],
  runOne: (target: T, deps: PassDeps) => Promise<unknown>,
  overrides: Partial<StartOptions> = {},
): ObserverHandle {
  const options = startOptions(overrides);
  checkOptions(options);
  checkHeartbeat(options.heartbeatMs, options.maxWaitMs);
  const { doc, timers, now } = options;
  // Stopped in the order they were started; `stop` runs once, from disconnect or when the extension is gone, and
  // nothing pokes the batcher after it (a pass still running finishes, and may not ask for another).
  const stops: (() => void)[] = [];
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    for (const each of stops.splice(0)) each();
  };
  let runners: readonly SerialRunner[] = [];
  const batcher = createBatcher(() => {
    if (!options.contextAlive()) stop();
    else if (!isPrerendering(doc)) for (const runner of runners) runner.request();
  }, options);
  const poke = (): void => {
    if (!stopped) batcher.poke();
  };
  const activity = trackUserActivity(options.view, { now, timers });
  const sync = trackPageSync(options.view, { now, timers, requestPass: poke });
  const post = stoppingWhenGone(options.post, options.contextAlive, stop);
  const userActive = overrides.userActive ?? activity.active;
  const deps: PassDeps = { ...options, post, userActive, vouches: overrides.vouches ?? sync.vouches };
  runners = targets.map((target) => serialRunner(() => runOne(target, deps)));
  const watch = watchMutations(doc, poke, options.Watcher, watchedInit(targets.map((t) => t.attributes)));
  doc.addEventListener(PRERENDERING_CHANGE, poke);
  const stopHeartbeat = startHeartbeat(doc, timers, options.heartbeatMs, poke);
  stops.push(
    activity.disconnect,
    sync.disconnect,
    watch.disconnect,
    () => {
      doc.removeEventListener(PRERENDERING_CHANGE, poke);
    },
    stopHeartbeat,
    batcher.cancel,
    ...runners.map((runner) => runner.halt),
  );
  poke();
  return Object.freeze({
    disconnect: stop,
    settled: async (): Promise<void> => {
      await Promise.all(runners.map((runner) => runner.idle()));
    },
  });
}

/**
 * Starts the skeleton for a content script's `observers` (`startPasses`, each pass `runPass`). Throws
 * `ObserverError` for an invalid observer or options, before it attaches any listener.
 */
export function startObservers(
  observers: readonly Observer[],
  overrides: Partial<StartOptions> = {},
): ObserverHandle {
  if (observers.length === 0) throw new ObserverError('invalid_observer');
  for (const observer of observers) assertObserver(observer);
  return startPasses(observers, runPass, overrides);
}

/** `startObservers` for a content script with one observer. */
export function startObserver(observer: Observer, overrides: Partial<StartOptions> = {}): ObserverHandle {
  return startObservers([observer], overrides);
}
