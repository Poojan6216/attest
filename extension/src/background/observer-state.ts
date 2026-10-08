/**
 * What the service worker remembers between one observer message and the next of the same pass (sprint_2 2.7;
 * Decisions [2.7]). In memory only, and only what is safe to lose (extension_engineer rule 3: no in-memory state that
 * matters): when the worker restarts it is empty, and every loss errs towards less coverage or a DEGRADED that stays
 * one pass longer (Hard Rules 5, 6), never towards more.
 *
 *  - `serially`: one observer's messages are handled one at a time, in arrival order (docs/grading.md §3; the 2.7
 *    carry-forward), whichever tab sent them.
 *  - Own health: the latest report each observer sent of itself, so a later message of that pass, once accepted,
 *    can clear a DEGRADED the service worker set (src/ledger/health.ts). Lost: the DEGRADED stays until the next pass.
 *    An IDLE report is not kept: its pass sends nothing else, and kept it would hide, from a tab on another folder,
 *    the report of the pass whose rows follow (sprint_2 2.11).
 *  - Refused passes: the instants of passes with a refused row, so their coverage is refused too. Lost: the observer
 *    already stopped that pass when its post was refused (src/observers/base.ts), so it sends no coverage anyway.
 *  - Held Calendar pings: a Calendar pass with a known account posts its coverage pings before its snapshot, and its
 *    rows come from the snapshot (./calendar-pass.ts), so its windows are held, per sending tab, until the snapshot
 *    of the same pass arrives, and recorded only after its rows are stored. Lost or expired: that pass records no
 *    coverage.
 */
import { CALENDAR_PASS_HOLD_MS } from '../config';
import { instantMs } from '../core/normalize';
import type { HealthReport as AdapterHealth } from '../core/schema';
import type { MessageSender } from '../bus/listen';
import type { CoveragePing } from '../ledger/types';

/** How many refused pass instants are remembered per observer. */
const REFUSED_KEPT = 32;

export interface HeldPass {
  readonly observerId: string;
  readonly syncMs: number;
  readonly accountHash: string;
  readonly pings: readonly CoveragePing[];
  readonly heldMs: number;
}

export interface PassState {
  readonly queues: Map<string, Promise<unknown>>;
  readonly ownHealth: Map<string, AdapterHealth>;
  readonly refused: Map<string, number[]>;
  readonly held: Map<string, HeldPass>;
}

export function createPassState(): PassState {
  return { queues: new Map(), ownHealth: new Map(), refused: new Map(), held: new Map() };
}

/** Runs `job` after every earlier job of `observerId` settled; one failing job never blocks the next. */
export function serially<T>(state: PassState, observerId: string, job: () => Promise<T>): Promise<T> {
  const previous = state.queues.get(observerId) ?? Promise.resolve();
  const run = previous.then(job, job);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  state.queues.set(observerId, tail);
  void tail.then(() => {
    if (state.queues.get(observerId) === tail) state.queues.delete(observerId);
  });
  return run;
}

export function noteOwnHealth(state: PassState, report: AdapterHealth): void {
  if (report.status === 'IDLE') return;
  const known = state.ownHealth.get(report.adapterId);
  if (known === undefined || instantMs(report.checkedAt) >= instantMs(known.checkedAt)) {
    state.ownHealth.set(report.adapterId, report);
  }
}

/** The observer's own report of the pass read at `passMs`, if that is the latest one it sent. */
export function ownReportOf(state: PassState, observerId: string, passMs: number): AdapterHealth | undefined {
  const known = state.ownHealth.get(observerId);
  return known !== undefined && instantMs(known.checkedAt) === passMs ? known : undefined;
}

export function noteRefused(state: PassState, observerId: string, passMs: number): void {
  const kept = state.refused.get(observerId) ?? [];
  if (!kept.includes(passMs)) kept.push(passMs);
  state.refused.set(observerId, kept.slice(-REFUSED_KEPT));
}

export function wasRefused(state: PassState, observerId: string, passMs: number): boolean {
  return state.refused.get(observerId)?.includes(passMs) ?? false;
}

/**
 * The tab, frame and document that sent a message: one content script, whose passes run one at a time. An extension
 * page has no tab; its URL names it.
 */
export function senderKey(sender: MessageSender): string {
  const tab = sender.tab?.id;
  const document = Reflect.get(sender, 'documentId');
  const page = typeof document === 'string' ? document : (sender.url ?? '');
  return `${tab === undefined ? '-' : String(tab)}:${String(sender.frameId ?? '-')}:${page}`;
}

function dropExpired(state: PassState, nowMs: number): void {
  for (const [key, pass] of state.held) {
    if (nowMs - pass.heldMs > CALENDAR_PASS_HOLD_MS) state.held.delete(key);
  }
}

/**
 * Holds a Calendar ping of a pass with a known account until the pass's snapshot. A ping of another pass from the
 * same sender replaces what was held (that pass's snapshot never came). Returns false when the ping names another
 * account than the pings of its own pass already held: one pass reads one page.
 */
export function holdPing(state: PassState, key: string, ping: CoveragePing, nowMs: number): boolean {
  dropExpired(state, nowMs);
  const syncMs = instantMs(ping.lastSyncAt);
  const accountHash = ping.accountHash ?? '';
  const held = state.held.get(key);
  const samePass = held?.observerId === ping.observerId && held.syncMs === syncMs;
  if (samePass && held.accountHash !== accountHash) return false;
  const pings = samePass ? [...held.pings, ping] : [ping];
  state.held.set(key, { observerId: ping.observerId, syncMs, accountHash, pings, heldMs: nowMs });
  return true;
}

/** The pings held for the pass of `observerId` read at `syncMs` by this sender, removed from the hold. */
export function takeHeld(
  state: PassState,
  key: string,
  observerId: string,
  syncMs: number,
  nowMs: number,
): HeldPass | undefined {
  dropExpired(state, nowMs);
  const held = state.held.get(key);
  if (held?.observerId !== observerId || held.syncMs !== syncMs) return undefined;
  state.held.delete(key);
  return held;
}
