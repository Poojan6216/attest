/**
 * A Calendar pass with a known account, completed by its snapshot (sprint_2 2.7 interfaces 2, 5; docs/grading.md §3,
 * §4.1, §7; Decisions [2.7]; Hard Rules 2, 4, 5, 6, 7).
 *
 * On such a page the content script posts no rows of its own (entrypoints/content/gcal.content.ts): the service
 * worker holds the store of the range's previous snapshot, so it derives every row here, from the step between that
 * snapshot and this one (./calendar-step.ts), and a first look at a range, a calendar switched on or a day that was
 * hidden yields first sightings, an edit an update, and a deletion only once confirmed. In order:
 *  1. The snapshot must come from the Calendar observer, carry the page's account hash, and agree with the coverage
 *     pings of its own pass (held by ./observer-state.ts): same account, windows inside its range. Otherwise it is
 *     refused `invalid_input` and the observer is DEGRADED. Without an account it is skipped: a page with no account
 *     is compared with nothing (its rows came from the content script, ./calendar-rows.ts).
 *  2. The clock (Decisions [2.7] wave E; Hard Rules 4, 5, 7). The pass's write instant is the service worker's clock.
 *     A snapshot read after it was read before the clock went back: nothing of it is stored (`clock_behind`, logged
 *     `observer.clock_behind`, not DEGRADED; the next pass reads the page again), so no record, window or marker is
 *     ever stored with an instant after the clock that stored it. Then src/ledger/clock-guard.ts `guardClock` runs:
 *     if the clock is below what the ledger stored, it deletes every interval and record stored "in the future" (their
 *     chains restart) and the Calendar rows first seen then that no batch read, and raises the clock floor. Every
 *     window this pass records with `changesSince` below that floor is lifted to it, or recorded without
 *     `changesSince` while the pass was read before it: a chain restarted after the clock went back never vouches
 *     for changes before the latest instant stamped before it.
 *  3. Everything else happens in ONE readwrite transaction (src/ledger/first-look.ts `inCalendarPass`), all or none
 *     (§3): the rows, the first-look marker of every first sighting, the snapshot record, the windows and the latest
 *     pings. A worker stopped half way, or any refusal, leaves nothing of the pass.
 *  4. A snapshot read at or before the stored one of its range (another tab's pass that landed late) is skipped:
 *     comparing an older page with a newer base would read time backwards. It changes nothing and is not DEGRADED,
 *     since nothing is wrong with the page (Hard Rule 6: never cry wolf); its windows are not recorded.
 *  5. Each row is projected (core `project`, so it is exactly what an observer would have sent) with `observedAt` =
 *     when it was first seen, and stored (./calendar-rows.ts): a first sighting with its marker, a change as it is.
 *     A change whose comparison base was read too long before it (./calendar-step.ts `staleChangeMs`) is a first
 *     sighting, and so is a creation or an update another range's view held first (read after this range's base,
 *     before this pass, ./calendar-seen.ts): either way this pass is not when the change happened.
 *     The first refusal aborts the transaction: DEGRADED, `{ ok: false, code }`, nothing stored, and the range's
 *     record is then dropped, so the next pass is a first look at a new instant (its rows first sightings with
 *     markers): a pass refused on a row it derives again from the same record every time (a confirmed deletion first
 *     seen before another view stored it) would otherwise be refused for good.
 *  6. Then the record is stored, and the pass's windows are recorded as the step says: with `changesSince` (a
 *     complete pass with nothing pending), without it (a pass that cannot vouch for changes), or not at all (a pass
 *     waiting to confirm an absence; its first sightings still have their markers).
 */
import { ACK_OK, type BusAck, type CalendarSnapshotMessage, type LedgerTable } from '../bus/messages';
import type { MessageSender } from '../bus/listen';
import { instantMs } from '../core/normalize';
import type { Policy } from '../core/policy';
import { project, RedactError } from '../core/redact';
import type { Sha256 } from '../core/schema';
import {
  type CalendarRecordKey,
  dropCalendarRecord,
  getCalendarRecord,
  putCalendarRecord,
} from '../ledger/calendar-snapshots';
import { guardClock } from '../ledger/clock-guard';
import type { LedgerDb } from '../ledger/db';
import { inCalendarPass } from '../ledger/first-look';
import type { CoveragePing, IsoTs } from '../ledger/types';
import { log } from '../log';
import type { CalendarSnapshot } from '../observers/gcal/snapshot';
import { CalendarRowRefused, type CalendarWrite, writeCalendarRows } from './calendar-rows';
import { type CalendarCoverage, type CalendarRow, calendarStep, staleChangeMs } from './calendar-step';
import { seenFirstElsewhere } from './calendar-seen';
import {
  accepted,
  clockBehind,
  type ObserverContext,
  recordPing,
  refuse,
  sourceOf,
} from './observer-messages';
import { senderKey, serially, takeHeld, wasRefused } from './observer-state';
import type { RowCode } from './row-codes';

/** The day after a `YYYY-MM-DD` day, as `YYYY-MM-DD` (UTC calendar arithmetic: no zone is involved). */
function dayAfter(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + 1)).toISOString().slice(0, 10);
}

/**
 * Whether a ping's window lies inside the snapshot's range, on days the snapshot saw whole: it starts on a visible
 * day and ends no later than the midnight after the last one (both read as the local dates the observer wrote them
 * in), and every day it reaches into is whole: its first day, and each visible day before the day its end falls on (a
 * window ends at the first instant of the day after its run, which may be a hidden one). A window over a day hidden
 * behind "N more" would report that day as seen (Hard Rule 5): the observer never sends one (src/observers/gcal/
 * pass.ts), so one that does is refused.
 */
export function windowInRange(ping: CoveragePing, snapshot: CalendarSnapshot): boolean {
  const first = snapshot.days[0]?.date;
  const last = snapshot.days[snapshot.days.length - 1]?.date;
  if (first === undefined || last === undefined) return false;
  const startDay = ping.windowStart.slice(0, 10);
  const endDay = ping.windowEnd.slice(0, 10);
  if (startDay < first || startDay > last || endDay > dayAfter(last)) return false;
  const reached = (date: string): boolean => date === startDay || (date > startDay && date < endDay);
  return snapshot.days.every((day) => day.complete || !reached(day.date));
}

/** Each row as the observer's `project()` would have produced it, first seen when the step says; null if one fails. */
function projectRows(rows: readonly CalendarRow[], policy: Policy): CalendarWrite[] | null {
  const writes: CalendarWrite[] = [];
  for (const { row, sightedAt, firstSighting } of rows) {
    try {
      const context = { type: row.type, observedAt: sightedAt, rowKey: row.rowKey };
      writes.push({ observation: project('gcal.event', row.fields, context, policy), firstSighting });
    } catch (error) {
      if (!(error instanceof RedactError)) throw error;
      return null;
    }
  }
  return writes;
}

/** Whether a marker of this pass may say every calendar was shown: each listed one shown and named once (§6.1). */
function allCalendarsOf(snapshot: CalendarSnapshot): boolean {
  return snapshot.calendars.every((calendar) => calendar.shown && calendar.ambiguous !== true);
}

export interface CalendarPass {
  readonly observerId: string;
  readonly accountHash: Sha256;
  readonly snapshot: CalendarSnapshot;
  readonly pings: readonly CoveragePing[];
}

export type CalendarOutcome =
  | { readonly kind: 'late' }
  | { readonly kind: 'clock_behind' }
  | { readonly kind: 'refused'; readonly code: RowCode; readonly count: number }
  | { readonly kind: 'stored'; readonly tables: readonly LedgerTable[] };

/**
 * The pass's coverage above the clock floor (step 2 of the module comment): a `changesSince` below it is lifted to
 * it, or dropped while the pass was read before it.
 */
export function aboveFloor(
  coverage: CalendarCoverage,
  floorAt: IsoTs | undefined,
  readAt: IsoTs,
): CalendarCoverage {
  if (coverage.kind !== 'followed' || floorAt === undefined) return coverage;
  const floorMs = instantMs(floorAt);
  if (instantMs(coverage.changesSince) >= floorMs) return coverage;
  return floorMs <= instantMs(readAt) ? { kind: 'followed', changesSince: floorAt } : { kind: 'plain' };
}

/** Records the pass's windows as the step allows; returns whether any was recorded. */
async function recordWindows(
  db: LedgerDb,
  pings: readonly CoveragePing[],
  coverage: CalendarCoverage,
): Promise<boolean> {
  if (coverage.kind === 'none') return false;
  const changesSince = coverage.kind === 'followed' ? coverage.changesSince : undefined;
  for (const ping of pings) await recordPing(db, ping, changesSince);
  return pings.length > 0;
}

/** Drops the range's record, so its next pass is a first look (step 5 of the module comment). */
async function restartChain(db: LedgerDb, key: CalendarRecordKey): Promise<void> {
  if (await dropCalendarRecord(db, key)) {
    log.warn('observer.calendar_restarted', { observer: key.observerId, reason: 'refused' });
  }
}

/** What a pass is stored with besides itself: the service worker's clock and the clock floor (step 2). */
interface PassClock {
  readonly nowMs: number;
  readonly floorAt: IsoTs | undefined;
}

/** Steps 4 to 6, inside the pass's transaction; `count` learns how many rows the pass derived. */
async function storePass(
  db: LedgerDb,
  policy: Policy,
  pass: CalendarPass,
  clock: PassClock,
  count: { rows: number },
): Promise<CalendarOutcome> {
  const { observerId, accountHash, snapshot } = pass;
  const key = { observerId, accountHash, range: snapshot.range };
  const stored = (await getCalendarRecord(db, key)) ?? null;
  if (stored !== null && instantMs(stored.snapshot.readAt) >= instantMs(snapshot.readAt))
    return { kind: 'late' };
  const step = calendarStep(stored, snapshot, { staleAfterMs: staleChangeMs(policy) });
  count.rows = step.rows.length;
  const writes = projectRows(await seenFirstElsewhere(db, key, stored, snapshot, step.rows), policy);
  if (writes === null) throw new CalendarRowRefused('invalid_input');
  const owner = { observerId, accountHash, allCalendars: allCalendarsOf(snapshot) };
  const inserted = await writeCalendarRows(db, policy, writes, owner, { clockMs: clock.nowMs });
  await putCalendarRecord(db, { ...key, snapshot: step.snapshot, pending: [...step.pending] });
  const coverage = aboveFloor(step.coverage, clock.floorAt, snapshot.readAt);
  const recorded = await recordWindows(db, pass.pings, coverage);
  const tables: LedgerTable[] = ['calendarSnapshots'];
  if (inserted > 0) tables.push('observations', 'coverageIntervals');
  if (recorded) tables.push('coverageIntervals', 'coverage');
  return { kind: 'stored', tables: [...new Set(tables)] };
}

/** Steps 2 to 6 of the module comment, for a pass whose snapshot passed step 1, at the service worker's `nowMs`. */
export async function applyCalendarPass(
  db: LedgerDb,
  policy: Policy,
  pass: CalendarPass,
  nowMs: number,
): Promise<CalendarOutcome> {
  if (instantMs(pass.snapshot.readAt) > nowMs) return { kind: 'clock_behind' };
  const clock = { nowMs, floorAt: await guardClock(db, nowMs) };
  const count = { rows: 0 };
  try {
    return await inCalendarPass(db, () => storePass(db, policy, pass, clock, count));
  } catch (error) {
    if (!(error instanceof CalendarRowRefused)) throw error;
    const { observerId, accountHash, snapshot } = pass;
    await restartChain(db, { observerId, accountHash, range: snapshot.range });
    return { kind: 'refused', code: error.code, count: count.rows };
  }
}

/** Step 1 of the module comment: the pass's pings, or why the snapshot is refused or skipped. */
function pairPass(
  ctx: ObserverContext,
  message: CalendarSnapshotMessage,
  sender: MessageSender,
): CalendarPass | 'invalid' | 'no_account' {
  const { observerId, snapshot, accountHash } = message;
  if (sourceOf(observerId) !== 'gcal.event') return 'invalid';
  const now = instantMs(ctx.now());
  const held = takeHeld(ctx.state, senderKey(sender), observerId, instantMs(snapshot.readAt), now);
  if (accountHash === undefined) return 'no_account';
  const pings = held?.pings ?? [];
  const agrees = pings.every((ping) => ping.accountHash === accountHash && windowInRange(ping, snapshot));
  return agrees ? { observerId, accountHash, snapshot, pings } : 'invalid';
}

export async function onCalendarSnapshot(
  ctx: ObserverContext,
  message: CalendarSnapshotMessage,
  sender: MessageSender,
): Promise<BusAck> {
  const { observerId, snapshot } = message;
  return serially(ctx.state, observerId, async (): Promise<BusAck> => {
    const db = await ctx.db();
    const readMs = instantMs(snapshot.readAt);
    const base = { observerId, type: message.type, at: snapshot.readAt };
    if (wasRefused(ctx.state, observerId, readMs)) return ackSkipped(observerId, 'refused');
    const pass = pairPass(ctx, message, sender);
    if (pass === 'invalid') return refuse(ctx, db, { ...base, codes: new Set(['invalid_input']), count: 1 });
    if (pass === 'no_account') return ackSkipped(observerId, 'no_account');
    const outcome = await applyCalendarPass(db, ctx.policy, pass, instantMs(ctx.now()));
    if (outcome.kind === 'late') return ackSkipped(observerId, 'late');
    if (outcome.kind === 'clock_behind') return clockBehind(observerId, message.type);
    if (outcome.kind === 'refused')
      return refuse(ctx, db, { ...base, codes: new Set([outcome.code]), count: outcome.count });
    ctx.notify(outcome.tables);
    await accepted(ctx, db, observerId, readMs);
    return ACK_OK;
  });
}

/**
 * A snapshot that changes nothing: of a pass with a refused row (`refused`), of a page with no account
 * (`no_account`), or older than the stored one (`late`). Logged at info with the reason; only `no_account` is
 * answered `ok` (there was nothing to store), the others say they were not stored.
 */
function ackSkipped(observerId: string, reason: 'refused' | 'no_account' | 'late'): BusAck {
  log.info('observer.snapshot_skipped', { observer: observerId, reason });
  if (reason === 'no_account') return ACK_OK;
  return { ok: false, code: reason === 'late' ? 'late_sighting' : 'refused' };
}
