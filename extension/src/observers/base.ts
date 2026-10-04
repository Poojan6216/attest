/**
 * The observer base (sprint_2 2.0; build_spec §7 adapter contract; agents/adapter_engineer.md "Pattern"): the
 * standard content-script skeleton every Gmail and Calendar observer runs.
 *
 *   health() → extract() → redact.project() → bus
 *
 * A content script does nothing but `startObserver(observer)`. Each pass reads the clock once (src/clock.ts) and
 * decides what it may report (./plan.ts), then posts, in this order and one message at a time, each only after the
 * previous one was answered:
 *  1. `adapter.health`: OK, or DEGRADED with reason codes (Hard Rule 6: every pass reports its health);
 *  2. `observer.observations`: the rows `project()` accepted, at most SCHEMA_LIMITS.BATCH per message, each with
 *     `observedAt` = the instant the pass read the page (docs/grading.md §3, §10), never `sightedAt`;
 *  3. `coverage.ping`: only for a clean pass whose health was OK. A DEGRADED health, a row `project()` refused
 *     (`RedactError`), an unreadable account or window, or a message that failed its schema posts no coverage for
 *     that pass (Hard Rule 5; Sprint 1 close, SEC-3). The account's address never leaves, only its hash
 *     (./account.ts). An observer that asserts no coverage by design (`coverage: 'none'`, the Gmail receipt
 *     parsers) never posts one: its clean pass is health OK and its rows.
 * If a post rejects, the rest of the pass is not sent, so coverage never follows observations that were not
 * delivered. Known gap until Sprint 2.7: src/bus `send()` resolves `undefined` both when the service worker answered
 * and when the transport failed (it logs the failure), so only a rejected post is seen here (Decisions.md [2.0]).
 *
 * Passes run one at a time (./serial.ts): DOM mutations are batched (./batch.ts: debounce OBSERVER_DEBOUNCE_MS, at
 * most OBSERVER_MAX_WAIT_MS) and the first pass runs one debounce after start, or, on a page Chrome prerendered,
 * one debounce after the user opens it (Hard Rule 11: a page the user has not opened is not read). Read-only (Hard
 * Rule 3): nothing here writes the DOM, dispatches an event or reaches the network; `attest/no-act` lints all of
 * src/observers/**.
 */
import { send } from '../bus/send';
import {
  AdapterHealthMessage,
  type BusMessage,
  type BusMessageType,
  CoveragePingMessage,
  ObserverObservationsMessage,
} from '../bus/messages';
import { nowIso } from '../clock';
import { OBSERVER_DEBOUNCE_MS, OBSERVER_HOSTS, OBSERVER_MAX_WAIT_MS } from '../config';
import type { OffsetAt } from '../core/normalize';
import { DEFAULT_POLICY } from '../core/policy';
import { ComponentId, IsoTs, type Observation, ObservationSource, SCHEMA_LIMITS } from '../core/schema';
import { trackUserActivity } from './activity';
import { checkOptions, createBatcher, SYSTEM_TIMERS, type Timers, watchMutations } from './batch';
import { ObserverError } from './errors';
import { type PassPlan, type PassPolicy, planPass } from './plan';
import { serialRunner } from './serial';
import type { Observer } from './types';

export type * from './types';
export { PASS_REASONS, type PassPolicy, type PassReason } from './plan';

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
}

/**
 * What one pass did, for tests and the content script's own bookkeeping. Never posted. `clock.invalid` (the clock
 * gave no ISO instant, so nothing could be stamped or sent) appears only here.
 */
export interface PassResult {
  readonly status: 'OK' | 'DEGRADED';
  readonly reasons: readonly string[];
  /** The types of the messages posted and answered, in order. */
  readonly posted: readonly BusMessageType[];
  /** False when a post failed and the rest of the pass was not sent. */
  readonly complete: boolean;
}

/** The user's UTC offset in minutes at an instant, as this browser's time zone gives it. Not a clock read. */
export const browserOffsetAt: OffsetAt = (epochMs: number): number => -new Date(epochMs).getTimezoneOffset();

const OBSERVER_HOST_SET: ReadonlySet<string> = new Set(Object.values(OBSERVER_HOSTS).flat());

function hostsAreOurs(hosts: unknown): boolean {
  if (!Array.isArray(hosts) || hosts.length === 0) return false;
  return hosts.every((host: unknown) => typeof host === 'string' && OBSERVER_HOST_SET.has(host));
}

/** Absent (the observer asserts its visible window) or `'none'` (it asserts no coverage by design). */
function coverageIsKnown(coverage: unknown): boolean {
  return coverage === undefined || coverage === 'none';
}

/**
 * Throws `ObserverError('invalid_observer')` unless the observer's id, vendor and version are ComponentId tokens,
 * its source is an ObservationSource, its hosts are a non-empty subset of OBSERVER_HOSTS (Hard Rule 8), its
 * `coverage` is absent or `'none'`, and its four functions exist. A bad definition is a developer error and fails
 * loud at start, before any page is read.
 */
export function assertObserver(observer: Observer): void {
  const tokens = [observer.id, observer.vendor, observer.version];
  const valid =
    tokens.every((token) => ComponentId.safeParse(token).success) &&
    ObservationSource.safeParse(observer.source).success &&
    hostsAreOurs(observer.hosts) &&
    coverageIsKnown(observer.coverage) &&
    [observer.health, observer.extract, observer.account, observer.visibleWindow].every(
      (fn) => typeof fn === 'function',
    );
  if (!valid) throw new ObserverError('invalid_observer');
}

function healthMessage(observer: Observer, plan: PassPlan, checkedAt: IsoTs): BusMessage | null {
  const parsed = AdapterHealthMessage.safeParse({
    type: 'adapter.health',
    health: {
      adapterId: observer.id,
      version: observer.version,
      status: plan.status === 'DEGRADED' ? 'DEGRADED' : 'OK',
      reasons: plan.status === 'DEGRADED' ? plan.reasons : [],
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

function coverageMessage(
  observer: Observer,
  plan: PassPlan,
  lastSyncAt: IsoTs,
  userActive: boolean,
): BusMessage | null {
  if (plan.status !== 'OK') return null;
  const parsed = CoveragePingMessage.safeParse({
    type: 'coverage.ping',
    ping: { observerId: observer.id, lastSyncAt, ...plan.coverage, userActive },
  });
  return parsed.success ? parsed.data : null;
}

/** A DEGRADED pass that reports only `message.invalid`: a message of this pass failed its bus schema. */
const INVALID_MESSAGE: PassPlan = { status: 'DEGRADED', reasons: ['message.invalid'], observations: [] };

/**
 * The messages one pass posts, in order. When any of them fails its bus schema (a bug, never expected), the pass
 * posts only a DEGRADED `message.invalid` health report: nothing it cannot fully report goes out, coverage least of
 * all. Throws only if the observer itself was not checked by `assertObserver`.
 */
export function passMessages(
  observer: Observer,
  plan: PassPlan,
  at: IsoTs,
  userActive: boolean,
): BusMessage[] {
  const health = healthMessage(observer, plan, at);
  const observations = observationMessages(observer, plan.observations);
  const coverage = coverageMessage(observer, plan, at, userActive);
  const coverageOk = plan.status !== 'OK' || coverage !== null;
  if (health !== null && observations !== null && coverageOk) {
    return [health, ...observations, ...(coverage === null ? [] : [coverage])];
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
 * One pass: read the clock once, decide (./plan.ts), post each message after the previous one was answered.
 * Resolves what it did; never rejects. A post that rejects ends the pass: nothing after it is sent.
 */
export async function runPass(observer: Observer, deps: PassDeps): Promise<PassResult> {
  const clock = IsoTs.safeParse(deps.now());
  // Without a valid instant no health report can be stamped; src/clock.ts never gets here.
  if (!clock.success) return { status: 'DEGRADED', reasons: ['clock.invalid'], posted: [], complete: false };
  const observedAt = clock.data;
  const ctx = { observedAt, offsetAt: deps.offsetAt };
  const plan = planPass({ observer, doc: deps.doc, ctx, policy: deps.policy });
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

/** Everything `startObserver` can be given; each has a production default. */
export interface StartOptions extends PassDeps {
  readonly view: Window;
  readonly timers: Timers;
  readonly Watcher: typeof MutationObserver;
  readonly debounceMs: number;
  readonly maxWaitMs: number;
}

export interface ObserverHandle {
  /** Stops watching: no pass starts after this (a running one finishes). Listeners and timers are removed. */
  readonly disconnect: () => void;
  /** Settles when no pass is running or due. */
  readonly settled: () => Promise<void>;
}

function startOptions(overrides: Partial<StartOptions>): Omit<StartOptions, 'userActive'> {
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
  };
}

/** Fired on a prerendered document when it becomes the page the user opened (Chrome 108+). */
const PRERENDERING_CHANGE = 'prerenderingchange';

/**
 * True while Chrome prerenders the page (omnibox or speculation-rules prerendering), before the user has opened it.
 * Chrome injects content scripts into prerendered pages; a page the user has not opened is never read (Hard Rule 11).
 */
function isPrerendering(doc: Document): boolean {
  return Reflect.get(doc, 'prerendering') === true;
}

/**
 * Starts the skeleton for `observer` on this page: watches the DOM, runs a pass one debounce after start and after
 * every burst of mutations, one pass at a time. A prerendered page runs no pass until the user opens it; its first
 * pass is then one debounce later. Throws `ObserverError` for an invalid observer or options, before it attaches
 * any listener.
 */
export function startObserver(observer: Observer, overrides: Partial<StartOptions> = {}): ObserverHandle {
  assertObserver(observer);
  const options = startOptions(overrides);
  checkOptions(options);
  const activity = trackUserActivity(options.view, { now: options.now, timers: options.timers });
  const deps: PassDeps = { ...options, userActive: overrides.userActive ?? activity.active };
  const runner = serialRunner(() => runPass(observer, deps));
  const batcher = createBatcher(() => {
    if (!isPrerendering(options.doc)) runner.request();
  }, options);
  const watch = watchMutations(options.doc, batcher.poke, options.Watcher);
  options.doc.addEventListener(PRERENDERING_CHANGE, batcher.poke);
  batcher.poke();
  return Object.freeze({
    disconnect: (): void => {
      options.doc.removeEventListener(PRERENDERING_CHANGE, batcher.poke);
      watch.disconnect();
      batcher.cancel();
      runner.halt();
      activity.disconnect();
    },
    settled: runner.idle,
  });
}
