/**
 * The service worker's side of the observer passes (sprint_2 2.7; docs/grading.md §3 "Observer obligations";
 * Decisions [2.7]; Hard Rules 2, 4, 5, 6). Each handler is called by src/bus listen() with a message it already
 * parsed (Zod), runs one observer's messages one at a time (./observer-state.ts `serially`), stores what it may
 * through the ledger, and answers a `BusAck` (interface 6).
 *
 *  - `adapter.health`: the observer's own report, stored by src/ledger/health.ts's rule (a DEGRADED the service
 *    worker set stays until a later clean pass is fully accepted).
 *  - `observer.observations`: a Gmail row is stored on its own through `upsertObservation(db, row, policy)`, and the
 *    refusals are collected, so one refused row never stops the rest. Calendar rows (a page with no account: every
 *    one a first sighting) are stored all or none, each with its first-look marker (./calendar-rows.ts; docs/
 *    grading.md §3: a Calendar row never stays stored without what keeps it from accusing an agent). A row of another
 *    source than the observer reads, or of an observer the extension does not have, is refused `invalid_input` and
 *    never reaches the ledger. Any refusal: the observer is DEGRADED (`ledger.<code>`), the pass is remembered as
 *    refused (no coverage for it), and the answer is `{ ok: false, code }`. Only the code and the observer id are
 *    logged (Hard Rule 10). A `PolicyError` is a bug: it is never caught here, so it fails loud (bus.handler_failed,
 *    `failed`).
 *  - `coverage.ping`: recorded (src/ledger/coverage.ts `recordCoverage`, and the latest ping per account) only for a
 *    pass with no refused row, a known observer, its own source, and a window it can have seen: a Gmail window never
 *    ends after its sync, and a receipt window is one instant (interface 3). A Calendar ping with a known account is
 *    held until its pass's snapshot (./calendar-pass.ts), because that pass's rows come from the snapshot.
 *  - `calendar.snapshot`: ./calendar-pass.ts.
 * A message every part of which was stored clears a DEGRADED the service worker set before that pass.
 *
 * The clock (Decisions [2.7] wave E; Hard Rules 4, 5, 7). A message's write instant is the service worker's clock
 * (`ctx.now()`), the one the content scripts read too. A row sighted, or a ping synced, after it was read before the
 * clock went back: the message stores nothing and is answered `clock_behind` (logged `observer.clock_behind`, not
 * DEGRADED: nothing is wrong with the page, and its next pass reads it again), so no interval or marker is stored
 * with an instant after the clock. Before anything is stored, src/ledger/clock-guard.ts `guardClock` repairs a ledger
 * the clock went back below, and every row is written with the clock (`clockMs`), so a row first seen "in the future"
 * never refuses its re-sightings (`late_sighting`) until real time catches up.
 */
import { ACK_OK, type AckCode, ackRefused, type BusAck, type LedgerTable } from '../bus/messages';
import type { AdapterHealthMessage, CoveragePingMessage, ObserverObservationsMessage } from '../bus/messages';
import type { MessageSender } from '../bus/listen';
import { OBSERVER_SOURCES } from '../config';
import { instantMs } from '../core/normalize';
import type { Policy } from '../core/policy';
import { IsoTs, type Observation, type ObservationSource } from '../core/schema';
import { guardClock } from '../ledger/clock-guard';
import { recordCoverage } from '../ledger/coverage';
import type { LedgerDb } from '../ledger/db';
import {
  clearLedgerDegraded,
  LEDGER_REASON_PREFIX,
  markLedgerDegraded,
  recordOwnHealth,
} from '../ledger/health';
import { putCoveragePing, upsertObservation, type WriterClock } from '../ledger/repo';
import type { CoveragePing, ObserverCoverageInput } from '../ledger/types';
import { log } from '../log';
import { storeAccountlessRows, type StoredRows } from './calendar-rows';
import {
  holdPing,
  noteOwnHealth,
  noteRefused,
  ownReportOf,
  type PassState,
  senderKey,
  serially,
  wasRefused,
} from './observer-state';
import { rowCodeOf, type RowCode, worstCode } from './row-codes';

export { type RowCode, worstCode } from './row-codes';

/** What the observer handlers need. Every field is injected in tests. */
export interface ObserverContext {
  readonly db: () => Promise<LedgerDb>;
  readonly policy: Policy;
  readonly state: PassState;
  /** ISO 8601 with offset (src/clock.ts): the edge reads the clock, never the ledger. */
  readonly now: () => string;
  /** Tells open UI pages which tables moved (`ledger.changed`). */
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

const SOURCES: ReadonlyMap<string, ObservationSource> = new Map(Object.entries(OBSERVER_SOURCES));

/** The source `observerId` reads, or undefined for an observer the extension does not have. */
export function sourceOf(observerId: string): ObservationSource | undefined {
  return SOURCES.get(observerId);
}

export interface Refusal {
  readonly observerId: string;
  readonly type: string;
  readonly codes: ReadonlySet<RowCode>;
  /** The refused pass's instant. */
  readonly at: IsoTs;
  readonly version?: string | undefined;
  readonly count: number;
}

/**
 * Turns the observer DEGRADED (`ledger.<code>`, only for an observer the extension has: an unknown id gets no health
 * row), remembers the pass as refused, logs the code and the observer id only, and answers the worst code.
 */
export async function refuse(ctx: ObserverContext, db: LedgerDb, refusal: Refusal): Promise<BusAck> {
  const code = worstCode(refusal.codes);
  log.warn('observer.refused', {
    observer: refusal.observerId,
    type: refusal.type,
    code,
    count: refusal.count,
  });
  noteRefused(ctx.state, refusal.observerId, instantMs(refusal.at));
  if (sourceOf(refusal.observerId) !== undefined) {
    const reasons = [...refusal.codes].map((each) => `${LEDGER_REASON_PREFIX}${each}`);
    await markLedgerDegraded(db, {
      adapterId: refusal.observerId,
      reasons,
      at: refusal.at,
      version: refusal.version,
    });
    ctx.notify(['adapterHealth']);
  }
  return ackRefused(code);
}

/** Every part of the pass read at `passMs` that reached the service worker so far was stored: clear a DEGRADED. */
export async function accepted(
  ctx: ObserverContext,
  db: LedgerDb,
  observerId: string,
  passMs: number,
): Promise<void> {
  const own = ownReportOf(ctx.state, observerId, passMs);
  if (own === undefined || wasRefused(ctx.state, observerId, passMs)) return;
  if ((await clearLedgerDegraded(db, own)).cleared) ctx.notify(['adapterHealth']);
}

export async function onHealth(ctx: ObserverContext, message: AdapterHealthMessage): Promise<BusAck> {
  const { health } = message;
  return serially(ctx.state, health.adapterId, async (): Promise<BusAck> => {
    const db = await ctx.db();
    noteOwnHealth(ctx.state, health);
    if ((await recordOwnHealth(db, health)).written) ctx.notify(['adapterHealth']);
    return ACK_OK;
  });
}

/**
 * Stores a message's rows: Calendar rows all or none, with their markers (./calendar-rows.ts); any other row on its
 * own (`upsertObservation`). A row of another source than the observer reads is refused before the ledger (for
 * Calendar, with every other row of its message).
 */
async function storeRows(
  db: LedgerDb,
  policy: Policy,
  observerId: string,
  rows: readonly Observation[],
  clock: WriterClock,
): Promise<StoredRows> {
  const source = sourceOf(observerId);
  if (source === 'gcal.event') {
    if (rows.some((row) => row.source !== source)) return { inserted: 0, codes: new Set(['invalid_input']) };
    return storeAccountlessRows(db, policy, observerId, rows, clock);
  }
  let inserted = 0;
  const codes = new Set<RowCode>();
  for (const row of rows) {
    if (source === undefined || row.source !== source) {
      codes.add('invalid_input');
      continue;
    }
    try {
      if ((await upsertObservation(db, row, policy, clock)).inserted) inserted += 1;
    } catch (error) {
      const code = rowCodeOf(error);
      if (code === undefined) throw error;
      codes.add(code);
    }
  }
  return { inserted, codes };
}

/** The pass instant of a message's rows: their one sighting, or undefined when they differ (or there are none). */
function passInstant(rows: readonly Observation[]): number | undefined {
  const instants = new Set(rows.map((row) => instantMs(row.observedAt)));
  const [only] = instants;
  return instants.size === 1 ? only : undefined;
}

/** The latest sighting among the rows, or now: when a refused pass happened. */
function latestSighting(rows: readonly Observation[], now: () => string): IsoTs {
  const latest = rows.reduce<Observation | undefined>(
    (held, row) =>
      held === undefined || instantMs(row.observedAt) > instantMs(held.observedAt) ? row : held,
    undefined,
  );
  return latest?.observedAt ?? IsoTs.parse(now());
}

export async function onObservations(
  ctx: ObserverContext,
  message: ObserverObservationsMessage,
): Promise<BusAck> {
  const { observerId, observations } = message;
  return serially(ctx.state, observerId, async (): Promise<BusAck> => {
    const db = await ctx.db();
    const clockMs = instantMs(ctx.now());
    if (observations.some((row) => instantMs(row.observedAt) > clockMs)) {
      return clockBehind(observerId, message.type);
    }
    await guardClock(db, clockMs);
    const stored = await storeRows(db, ctx.policy, observerId, observations, { clockMs });
    if (stored.inserted > 0) ctx.notify(rowTables(observerId));
    if (stored.codes.size > 0) {
      for (const row of observations) noteRefused(ctx.state, observerId, instantMs(row.observedAt));
      const at = latestSighting(observations, ctx.now);
      return refuse(ctx, db, {
        observerId,
        type: message.type,
        codes: stored.codes,
        at,
        ...versioned(message),
      });
    }
    const passMs = passInstant(observations);
    if (passMs !== undefined) await accepted(ctx, db, observerId, passMs);
    return ACK_OK;
  });
}

/** The tables new rows of `observerId` moved: Calendar rows come with their first-look markers. */
function rowTables(observerId: string): LedgerTable[] {
  return sourceOf(observerId) === 'gcal.event' ? ['observations', 'coverageIntervals'] : ['observations'];
}

function versioned(message: ObserverObservationsMessage): { version: string; count: number } {
  return { version: message.version, count: message.observations.length };
}

/**
 * Why a ping cannot be what it says, or null. A Gmail window never ends after its sync. A Sent window ends exactly at
 * its sync: only the head of the Sent list writes coverage (interface 4, docs/grading.md §3), so a window that ends
 * earlier is an older page's, which cannot vouch for its span (Hard Rule 5). A receipt window is one instant.
 */
export function pingProblem(ping: CoveragePing): 'unknown_observer' | 'source' | 'window' | null {
  const source = sourceOf(ping.observerId);
  if (source === undefined) return 'unknown_observer';
  if (ping.source !== source) return 'source';
  const startMs = instantMs(ping.windowStart);
  const endMs = instantMs(ping.windowEnd);
  const syncMs = instantMs(ping.lastSyncAt);
  if (source !== 'gcal.event' && endMs > syncMs) return 'window';
  if (source === 'gmail.sent' && endMs !== syncMs) return 'window';
  if (source === 'gmail.receipt' && startMs !== endMs) return 'window';
  return null;
}

/** The core coverage entry a ping asserts, with `changesSince` when the ledger followed the window's changes. */
export function entryOf(ping: CoveragePing, changesSince?: IsoTs): ObserverCoverageInput {
  const entry: ObserverCoverageInput = {
    observerId: ping.observerId,
    source: ping.source,
    lastSyncAt: ping.lastSyncAt,
    windowStart: ping.windowStart,
    windowEnd: ping.windowEnd,
    ...(ping.accountHash === undefined ? {} : { accountHash: ping.accountHash }),
    ...(ping.allCalendars === undefined ? {} : { allCalendars: ping.allCalendars }),
  };
  return changesSince === undefined ? entry : { ...entry, changesSince };
}

/** Records one ping's window and keeps it as the latest ping of its observer and account. */
export async function recordPing(db: LedgerDb, ping: CoveragePing, changesSince?: IsoTs): Promise<void> {
  await recordCoverage(db, entryOf(ping, changesSince));
  await putCoveragePing(db, ping);
}

const COVERAGE_TABLES: readonly LedgerTable[] = ['coverageIntervals', 'coverage'];

export async function onCoveragePing(
  ctx: ObserverContext,
  message: CoveragePingMessage,
  sender: MessageSender,
): Promise<BusAck> {
  const { ping } = message;
  return serially(ctx.state, ping.observerId, async (): Promise<BusAck> => {
    const db = await ctx.db();
    const syncMs = instantMs(ping.lastSyncAt);
    const base = { observerId: ping.observerId, type: message.type, at: ping.lastSyncAt, count: 1 };
    if (pingProblem(ping) !== null) return refuse(ctx, db, { ...base, codes: new Set(['invalid_input']) });
    if (wasRefused(ctx.state, ping.observerId, syncMs)) return refusedCoverage(ping);
    const clockMs = instantMs(ctx.now());
    if (syncMs > clockMs) return clockBehind(ping.observerId, message.type);
    if (ping.source === 'gcal.event' && ping.accountHash !== undefined) {
      const held = holdPing(ctx.state, senderKey(sender), ping, clockMs);
      return held ? ACK_OK : refuse(ctx, db, { ...base, codes: new Set(['invalid_input']) });
    }
    await guardClock(db, clockMs);
    await recordPing(db, ping);
    ctx.notify(COVERAGE_TABLES);
    await accepted(ctx, db, ping.observerId, syncMs);
    return ACK_OK;
  });
}

/**
 * A message read before the clock went back (its rows sighted, or its window synced, after the service worker's
 * clock): nothing of it is stored, so no interval, marker or record is ever stored after the clock that stored it.
 * Logged as a warning, never DEGRADED: nothing is wrong with the page, and its next pass is read on the clock as it is.
 */
export function clockBehind(observerId: string, type: string): BusAck {
  log.warn('observer.clock_behind', { observer: observerId, type });
  return ackRefused('clock_behind');
}

/** Coverage of a pass with a refused row: never recorded (Hard Rule 5). The pass is already DEGRADED. */
function refusedCoverage(ping: CoveragePing): BusAck {
  log.info('observer.coverage_refused', { observer: ping.observerId });
  return ackRefused('refused' satisfies AckCode);
}
