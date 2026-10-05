/**
 * What the page's life tells the observer skeleton (./base.ts; sprint_2 2.0, 2.7; Hard Rules 5, 6, 11): when to
 * read the page, and whether a read can vouch that the page shows the present.
 *
 * When to read: a heartbeat while the page is visible (`startHeartbeat`, which the Calendar content script turns
 * on), and never while Chrome prerenders a page the user has not opened (`isPrerendering`, Hard Rule 11).
 *
 * Whether a read vouches for the present (`trackPageSync`; Decisions [2.close] S4, QA-V2). A pass's coverage says
 * the page showed everything up to the pass instant: the Sent head's window ends there, and every ping's
 * `lastSyncAt` is the pass. A page that is offline, or has only just come back, shows what it had before: a mail sent
 * from the phone, or an event an agent made through the API, is missing from it until it syncs, and a ping read from
 * it could let a claim grade NOT_FOUND although the mail or the event exists (Hard Rule 5). So:
 *  - while the page reports itself offline (`navigator.onLine` false), no pass vouches;
 *  - when it comes back (an `online` event; a `resume`, after the tab was frozen; a `visibilitychange` to visible after
 *    PAGE_RESYNC_HIDDEN_MS or more hidden; or a gap of PAGE_SLEEP_GAP_MS or more since the page's own tick last ran,
 *    because a sleeping machine sends a page no event at all), each observer's first pass does not vouch, and no pass
 *    within PAGE_RESYNC_MS does: the pass a reconnect banner or the wake-up redraw starts reads the page before it
 *    caught up. When that time is up a pass is requested, so coverage resumes on a quiet page too.
 * A pass that does not vouch still posts its health and its rows (a row the page shows is evidence it showed it), but
 * no coverage ping and no Calendar snapshot (the snapshot is the base the next pass's changes are dated against).
 * Its health is what the pass found: a page catching up is not a broken observer (Hard Rule 6: never cry wolf).
 * Known limit: a page whose network is up but whose server cannot be reached reports itself online; only its own
 * banner says otherwise, and the live smoke (sprint_2 2.8) checks what the observers do then.
 *
 * Listening is not acting (Hard Rule 3): every listener here is passive, reads nothing of its event, and keeps only
 * instants; nothing here writes the page.
 */
import { PAGE_RESYNC_HIDDEN_MS, PAGE_RESYNC_MS, PAGE_SLEEP_GAP_MS, PAGE_TICK_MS } from '../config';
import { instantMs } from '../core/normalize';
import { type TimerHandle, type Timers } from './batch';
import { ObserverError } from './errors';

const VISIBILITY_CHANGE = 'visibilitychange';

/** Fired on a prerendered document when it becomes the page the user opened (Chrome 108+). */
export const PRERENDERING_CHANGE = 'prerenderingchange';

/**
 * True while Chrome prerenders the page (omnibox or speculation-rules prerendering), before the user has opened it.
 * Chrome injects content scripts into prerendered pages; a page the user has not opened is never read (Hard Rule 11).
 */
export function isPrerendering(doc: Document): boolean {
  return Reflect.get(doc, 'prerendering') === true;
}

/**
 * A heartbeat is off (null) or a whole number of ms no shorter than the max wait, so it never outpaces a burst.
 * Throws `ObserverError('invalid_options')` otherwise.
 */
export function checkHeartbeat(heartbeatMs: number | null, maxWaitMs: number): void {
  if (heartbeatMs === null) return;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < maxWaitMs)
    throw new ObserverError('invalid_options');
}

/**
 * While the page is visible, pokes every `everyMs`, and pokes when it becomes visible again. Reading is not acting
 * (Hard Rule 3): the listener reads only `visibilityState`. Returns the function that stops it.
 */
export function startHeartbeat(
  doc: Document,
  timers: Timers,
  everyMs: number | null,
  poke: () => void,
): () => void {
  if (everyMs === null) return () => undefined;
  let handle: TimerHandle | undefined;
  const visible = (): boolean => doc.visibilityState === 'visible';
  const beat = (): void => {
    if (visible()) poke();
    handle = timers.setTimeout(beat, everyMs);
  };
  const onVisibility = (): void => {
    if (visible()) poke();
  };
  handle = timers.setTimeout(beat, everyMs);
  doc.addEventListener(VISIBILITY_CHANGE, onVisibility);
  return () => {
    doc.removeEventListener(VISIBILITY_CHANGE, onVisibility);
    if (handle !== undefined) timers.clearTimeout(handle);
    handle = undefined;
  };
}

/** Whether a page's reads vouch for the present (see the module comment). */
export interface PageSync {
  /**
   * Whether the pass `observerId` read at `atMs` (epoch ms) can vouch that the page showed the present. Call it once
   * per pass: it notes the pass.
   */
  readonly vouches: (observerId: string, atMs: number) => boolean;
  /** Removes every listener and timer. */
  readonly disconnect: () => void;
}

export interface PageSyncOptions {
  /** The clock (src/clock.ts nowIso): ISO 8601 with offset. */
  readonly now: () => string;
  readonly timers: Timers;
  /** Asks for a pass: called when a catch-up is over, so a quiet page's coverage resumes. */
  readonly requestPass: () => void;
}

const LISTENER_OPTIONS: AddEventListenerOptions = Object.freeze({ capture: true, passive: true });

/** The page's own events that say it came back: their targets, so `disconnect` removes exactly what was added. */
function comebackEvents(view: Window): readonly (readonly [EventTarget, string])[] {
  return [
    [view, 'online'],
    [view.document, 'resume'],
    [view.document, VISIBILITY_CHANGE],
  ];
}

/** What the tracker keeps: instants and flags only, never anything the page showed. */
interface SyncState {
  /** When the page last came back (null: not since it loaded). */
  since: number | null;
  /** The observers that ran a pass since then. */
  readonly passed: Set<string>;
  /** A pass found the page offline, and no `online` event has said it came back since. */
  offline: boolean;
  /** When the page was hidden (null: it is visible). */
  hiddenAt: number | null;
  /** The last instant the page's own code ran: its tick, a pass or an event. */
  aliveAt: number;
  tick: TimerHandle | undefined;
  due: TimerHandle | undefined;
}

/** The page came back at `atMs`: each observer's next pass is its first since, and a pass is due PAGE_RESYNC_MS on. */
function comeBack(state: SyncState, options: PageSyncOptions, atMs: number): void {
  state.since = atMs;
  state.passed.clear();
  if (state.due !== undefined) options.timers.clearTimeout(state.due);
  state.due = options.timers.setTimeout(() => {
    state.due = undefined;
    options.requestPass();
  }, PAGE_RESYNC_MS);
}

/** The page ran at `atMs`: after a gap no throttled tab has, it slept, and comes back now. */
function noteAlive(state: SyncState, options: PageSyncOptions, atMs: number): void {
  if (atMs - state.aliveAt >= PAGE_SLEEP_GAP_MS) comeBack(state, options, atMs);
  state.aliveAt = Math.max(state.aliveAt, atMs);
}

/** One of `comebackEvents` at `atMs`, with the page's visibility then. */
function onPageEvent(
  state: SyncState,
  options: PageSyncOptions,
  event: { readonly type: string; readonly visibility: DocumentVisibilityState },
  atMs: number,
): void {
  noteAlive(state, options, atMs);
  if (event.type !== VISIBILITY_CHANGE) {
    state.offline = false;
    comeBack(state, options, atMs);
  } else if (event.visibility === 'hidden') {
    state.hiddenAt ??= atMs;
  } else {
    if (state.hiddenAt !== null && atMs - state.hiddenAt >= PAGE_RESYNC_HIDDEN_MS)
      comeBack(state, options, atMs);
    state.hiddenAt = null;
  }
}

/** Whether the page says it is offline. Only an explicit `false` counts: a page that does not say is not offline. */
function reportsOffline(view: Window): boolean {
  const online: unknown = Reflect.get(view.navigator, 'onLine');
  return online === false;
}

/** `PageSync.vouches` for the pass `observerId` read at `atMs` (see the module comment). */
function passVouches(
  state: SyncState,
  options: PageSyncOptions,
  view: Window,
  observerId: string,
  atMs: number,
): boolean {
  noteAlive(state, options, atMs);
  if (reportsOffline(view)) {
    state.offline = true;
    return false;
  }
  // Back online without an `online` event reaching the page: it comes back now.
  if (state.offline) {
    state.offline = false;
    comeBack(state, options, atMs);
  }
  if (state.since === null) return true;
  const first = !state.passed.has(observerId);
  state.passed.add(observerId);
  const waited = atMs - state.since >= PAGE_RESYNC_MS;
  // Its first pass came only after the wait (a quiet page): one more pass, which then vouches.
  if (first && waited) options.requestPass();
  return waited && !first;
}

/** Tracks whether `view`'s page can vouch for the present (see the module comment). */
export function trackPageSync(view: Window, options: PageSyncOptions): PageSync {
  const doc = view.document;
  const nowMs = (): number => instantMs(options.now());
  const state: SyncState = {
    since: null,
    passed: new Set<string>(),
    offline: false,
    hiddenAt: doc.visibilityState === 'hidden' ? nowMs() : null,
    aliveAt: nowMs(),
    tick: undefined,
    due: undefined,
  };
  const onEvent = (event: Event): void => {
    onPageEvent(state, options, { type: event.type, visibility: doc.visibilityState }, nowMs());
  };
  const beat = (): void => {
    noteAlive(state, options, nowMs());
    state.tick = options.timers.setTimeout(beat, PAGE_TICK_MS);
  };
  const events = comebackEvents(view);
  for (const [target, type] of events) target.addEventListener(type, onEvent, LISTENER_OPTIONS);
  state.tick = options.timers.setTimeout(beat, PAGE_TICK_MS);
  return Object.freeze({
    vouches: (observerId: string, atMs: number): boolean =>
      passVouches(state, options, view, observerId, atMs),
    disconnect: (): void => {
      for (const [target, type] of events) target.removeEventListener(type, onEvent, LISTENER_OPTIONS);
      for (const handle of [state.tick, state.due])
        if (handle !== undefined) options.timers.clearTimeout(handle);
      state.tick = undefined;
      state.due = undefined;
    },
  });
}
