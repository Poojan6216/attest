/**
 * Clock safety (docs/grading.md §3; docs/adapters.md §3.6; Decisions [2.7] wave E; Hard Rules 4, 5, 6, 7).
 *
 * Every instant the ledger keeps was read from the one wall clock the service worker, the content scripts and the
 * extension pages share. A clock that jumped forward and came back, or stepped back for good, leaves stored instants
 * after the clock's now, and each of them misleads once the clock passes it again:
 *  - a coverage interval synced "in the future", merged into a chain that began before it, vouches for a span its
 *    passes never saw: a change made after the clock came back reads as followed, a false NOT_FOUND or UNASKED;
 *  - a Calendar chain that restarts after the step begins below instants already stamped before it (a claim, a pass),
 *    so it says it followed changes it never compared;
 *  - a row first seen "in the future" refuses every earlier re-sighting (`late_sighting`), so its range is DEGRADED
 *    and records no coverage until real time catches up.
 *
 * The ledger keeps two `meta` facts:
 *  - `clockHighWater`: the latest instant stored since the last repair: each new row's and claim's sighting, each
 *    coverage interval's `lastSyncAt`, each Calendar record's `readAt` and each observer health report's `checkedAt`
 *    (`noteStoredInstant`, written in the transaction that stores the fact). Each was read at or before the now of
 *    the transaction that stored it, so a later now below it means the clock went back. Batch instants are not
 *    counted: a batch reads, it is not evidence.
 *  - `clockFloorAt`: written by a repair, never lowered: the latest instant stamped before the clock went back. No
 *    Calendar chain vouches for changes before it (src/background/calendar-pass.ts lifts `changesSince` to it).
 *
 * `guardClock(db, nowMs)` runs before anything of an observer message is stored (the service worker's clock), and
 * must run before a grading batch records its instant (Sprint 3.6). When now is below the high water (or below a
 * stored Calendar record's `readAt`, for records stored before the high water existed), it repairs, in one readwrite
 * transaction:
 *  1. every coverage interval synced after now (any source; windows and first-look markers) is deleted: it never
 *     vouches for anything, and no later pass is merged into it;
 *  2. every latest ping synced after now is deleted (it would keep newer pings out);
 *  3. every Calendar record read after now is deleted: its range's chain restarts, nothing carried across;
 *  4. every Calendar row first seen after now that no batch has read (`observedAt` after the last batch instant) is
 *     deleted: the next pass derives it again, first seen in the present, with its first-look marker. A row a batch
 *     read stays as it is (replay, Hard Rule 4): its earlier re-sightings are no-ops (./upsert.ts `clockMs`), and the
 *     floor keeps any chain from reading it as a change it followed;
 *  5. every observer health report checked after now is repaired (SEC-4): otherwise every honest report would be
 *     older than it and ignored (./health.ts), so a stored OK would hide a real DEGRADED, and a DEGRADED the service
 *     worker set could not be cleared, until real time caught up. The observer's own report is deleted (its next
 *     report, the message being stored included, takes its place); a DEGRADED the service worker set is re-stamped
 *     at now, its reasons kept, so it still stands until a later clean pass is accepted (Hard Rule 6);
 *  6. the floor becomes the high water (or stays, if higher) and the high water is cleared;
 *  7. it logs `ledger.clock_regressed` once, with counts only (the re-stamped health reports only when there were any).
 * Claims and other rows stay as stored: a batch may have graded with them.
 *
 * Known limit: a jump that comes back before anything is stored and before any batch runs leaves instants that are
 * no longer in the future when they are next looked at; the wall clock alone cannot tell them from real ones.
 */
import { firstSeenAt } from '../core/order';
import { log } from '../log';
import { lastBatchMs } from './batch-instant';
import { CalendarRecord } from './calendar-snapshots';
import { CLOCK_HIGH_WATER, readInstant } from './clock-high-water';
import { readRow, readRows, type LedgerDb } from './db';
import { setByLedger } from './health';
import { accountKeyOf, epochMs } from './index-fields';
import { AdapterHealth, CoveragePing, IsoTs, Observation } from './types';

export { CLOCK_HIGH_WATER, noteStoredInstant } from './clock-high-water';

/** The meta key of the floor below which no Calendar chain vouches for changes. Written only by a repair. */
export const CLOCK_FLOOR_AT = 'clockFloorAt';

/**
 * The tables a guard reads and repairs: its scope, or a subset of the caller's transaction. A caller that stores
 * with the guard in one transaction (src/background/observer-messages.ts) opens it over these.
 */
export function guardTables(db: LedgerDb) {
  return [
    db.meta,
    db.observations,
    db.coverageIntervals,
    db.coverage,
    db.calendarSnapshots,
    db.adapterHealth,
  ];
}

/** What a repair removed or re-stamped (step 7 of the header). */
interface ClockRepair {
  readonly intervals: number;
  readonly pings: number;
  readonly records: number;
  readonly rows: number;
  readonly health: number;
}

/** The later of two instants (as instants; the first on a tie), either possibly absent. */
function later(a: IsoTs | undefined, b: IsoTs | undefined): IsoTs | undefined {
  if (a === undefined) return b;
  return b === undefined || epochMs(a) >= epochMs(b) ? a : b;
}

/**
 * The latest instant stored that the clock may not be below, as it was written: the high water, or the latest
 * Calendar record's read (a record stored before the high water existed).
 */
async function highWater(db: LedgerDb): Promise<IsoTs | undefined> {
  const high = await readInstant(db, CLOCK_HIGH_WATER);
  const latest = readRow(
    'calendarSnapshots',
    CalendarRecord,
    await db.calendarSnapshots.orderBy('readMs').last(),
  );
  return later(high, latest?.snapshot.readAt);
}

/** Steps 1 and 2: the coverage intervals and latest pings synced after `nowMs`. */
async function dropFutureCoverage(
  db: LedgerDb,
  nowMs: number,
): Promise<{ intervals: number; pings: number }> {
  const intervals = await db.coverageIntervals
    .filter((row) => typeof row.syncMs === 'number' && row.syncMs > nowMs)
    .delete();
  const future = readRows('coverage', CoveragePing, await db.coverage.toArray()).filter(
    (ping) => epochMs(ping.lastSyncAt) > nowMs,
  );
  await db.coverage.bulkDelete(future.map((ping) => [ping.observerId, accountKeyOf(ping.accountHash)]));
  return { intervals, pings: future.length };
}

/** Step 4: the Calendar rows first seen after `nowMs` that no batch has read. */
async function dropUnreadFutureRows(db: LedgerDb, nowMs: number): Promise<number> {
  const lastMs = await lastBatchMs(db);
  const unread = readRows('observations', Observation, await db.observations.toArray()).filter(
    (row) =>
      row.source === 'gcal.event' &&
      epochMs(firstSeenAt(row)) > nowMs &&
      (lastMs === undefined || epochMs(row.observedAt) > lastMs),
  );
  await db.observations.bulkDelete(unread.map((row) => row.id));
  return unread.length;
}

/**
 * Step 5: every health report checked after `nowMs`: the observer's own deleted, a DEGRADED the service worker set
 * re-stamped at `nowMs` (status, reasons and version kept). The table holds one row per observer, so reading it
 * whole is bounded.
 */
async function repairFutureHealth(db: LedgerDb, nowMs: number): Promise<number> {
  const future = readRows('adapterHealth', AdapterHealth, await db.adapterHealth.toArray()).filter(
    (report) => epochMs(report.checkedAt) > nowMs,
  );
  const checkedAt = IsoTs.parse(new Date(nowMs).toISOString());
  const ledgerSet = (report: AdapterHealth): boolean => setByLedger(report);
  const own = future.filter((report) => !ledgerSet(report)).map((report) => report.adapterId);
  await db.adapterHealth.bulkDelete(own);
  await db.adapterHealth.bulkPut(future.filter(ledgerSet).map((report) => ({ ...report, checkedAt })));
  return future.length;
}

/** Steps 1 to 7 of the header, for a clock at `nowMs` below the stored high water `high`. */
async function repair(db: LedgerDb, nowMs: number, high: IsoTs): Promise<ClockRepair> {
  const floor = later(await readInstant(db, CLOCK_FLOOR_AT), high) ?? high;
  const coverage = await dropFutureCoverage(db, nowMs);
  const records = await db.calendarSnapshots.where('readMs').above(nowMs).delete();
  const rows = await dropUnreadFutureRows(db, nowMs);
  const health = await repairFutureHealth(db, nowMs);
  await db.meta.put({ key: CLOCK_FLOOR_AT, value: floor });
  await db.meta.delete(CLOCK_HIGH_WATER);
  const { intervals, pings } = coverage;
  // The health count is named only when a report was re-stamped (the earlier fields keep their exact shape).
  log.warn(
    'ledger.clock_regressed',
    health > 0 ? { intervals, pings, records, rows, health } : { intervals, pings, records, rows },
  );
  return { intervals, pings, records, rows, health };
}

/**
 * The guard of the header, at the clock `nowMs` (epoch ms) the caller reads for the message it is about to store:
 * repairs when the clock went back below what the ledger stored, then returns the floor in force (undefined when
 * the clock never went back). Whether a repair is due is decided by a read (TECH-2: the guard runs for every observer
 * message, and the clock almost never went back); the repair is one readwrite transaction over `guardTables` (`meta`,
 * `observations`, `coverageIntervals`, `coverage`, `calendarSnapshots` and `adapterHealth`), which checks again inside
 * it. Either runs in the caller's transaction when it has one with those tables.
 */
export async function guardClock(db: LedgerDb, nowMs: number): Promise<IsoTs | undefined> {
  const due = async (): Promise<IsoTs | undefined> => {
    const high = await highWater(db);
    return high !== undefined && nowMs < epochMs(high) ? high : undefined;
  };
  const seen = await db.transaction('r', [db.meta, db.calendarSnapshots], async () => ({
    high: await due(),
    floor: await readInstant(db, CLOCK_FLOOR_AT),
  }));
  if (seen.high === undefined) return seen.floor;
  return db.transaction('rw', guardTables(db), async (): Promise<IsoTs | undefined> => {
    const high = await due();
    if (high !== undefined) await repair(db, nowMs, high);
    return readInstant(db, CLOCK_FLOOR_AT);
  });
}
