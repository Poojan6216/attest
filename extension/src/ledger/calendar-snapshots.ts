/**
 * The Calendar snapshot store (sprint_2 2.7; Decisions [2.7]; Hard Rules 2, 5): for each Calendar observer, account
 * hash and visible range, the snapshot the service worker diffs that range's next pass against
 * (src/background/calendar-step.ts), keyed by `[observerId+accountHash+range]` (schema v3, db.ts STORES_V3).
 *
 * A record holds derived facts only, in the snapshot's stored form (src/observers/gcal/snapshot.ts `StoredSnapshot`:
 * event and calendar keys are SHA-256, subject hints ≤ 80 code points, instants, each event's first guest address
 * and a SHA-256 key per guest, never every guest address in clear: SEC-2), plus:
 *  - `pending`: the events of `snapshot` that one snapshot able to see them lacked, and since when. Such an event is
 *    kept in `snapshot` until a second snapshot confirms its absence (a deletion is reported only after the event is
 *    absent from two consecutive complete snapshots) or it comes back;
 *  - `updates`: per event of `snapshot`, how many `calendar.updated` rows its range reported in the current churn
 *    window, and since when (SEC-11: the cap on rows per event, src/background/calendar-churn.ts).
 * A snapshot given in its page form (what a pass posts; a record of format 1, stored before SEC-2) is read as its
 * stored form, so the store writes the stored form only and an older record is rewritten by the range's next pass.
 *
 * Every record is parsed with `CalendarRecord` on write and on read (Zod at the boundary). A stored record that fails
 * it reads as none (logged by id only, `ledger.row_invalid`): the next pass is then compared with nothing, which can
 * only turn changes into first sightings, never invent one (Hard Rule 5). A record is replaced only by one whose
 * snapshot was read later (`readAt`, compared as instants), so a pass that lands late never moves a range's base
 * back. The retention purge deletes the records read before its cutoff (`purgeCalendarRecords`); the service worker
 * drops a record to restart its range's chain (`dropCalendarRecord`: a refused pass), and the clock guard deletes the
 * records read after the clock's now (./clock-guard.ts).
 */
import { Dexie } from 'dexie';

import { instantMs } from '../core/normalize';
import { noteStoredInstant } from './clock-high-water';
import { readRow, type CalendarKey, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { CalendarRecord, type CalendarRecordInput, type CalendarRecordKey } from './calendar-record';

export {
  CalendarRecord,
  type CalendarRecordInput,
  type CalendarRecordKey,
  type CalendarRecordRow,
  PendingAbsence,
  UpdateWindow,
} from './calendar-record';

function keyOf(key: CalendarRecordKey): CalendarKey {
  return [key.observerId, key.accountHash, key.range];
}

function parseRecord(input: unknown): CalendarRecord {
  const parsed = CalendarRecord.safeParse(input);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)');
  throw new LedgerError('invalid_input', 'Invalid calendarSnapshots input', {
    table: 'calendarSnapshots',
    paths: [...new Set(paths)].slice(0, 8).join('|'),
  });
}

/** The stored record of one observer, account and range, or undefined (none, or one that fails its schema). */
export async function getCalendarRecord(
  db: LedgerDb,
  key: CalendarRecordKey,
): Promise<CalendarRecord | undefined> {
  return readRow('calendarSnapshots', CalendarRecord, await db.calendarSnapshots.get(keyOf(key)));
}

/**
 * Stores `input` (parsed first: `LedgerError('invalid_input')`, field names only, and nothing written) unless a
 * readable record of the same key holds a snapshot read at or after it. One readwrite transaction over
 * `calendarSnapshots` and `meta` (a stored `readAt` raises the clock's high water, ./clock-guard.ts).
 */
export async function putCalendarRecord(
  db: LedgerDb,
  input: CalendarRecordInput,
): Promise<{ readonly written: boolean }> {
  const record = parseRecord(input);
  const readMs = instantMs(record.snapshot.readAt);
  const table = db.calendarSnapshots;
  return db.transaction('rw', [table, db.meta], async (): Promise<{ written: boolean }> => {
    const stored = readRow('calendarSnapshots', CalendarRecord, await table.get(keyOf(record)));
    if (stored !== undefined && instantMs(stored.snapshot.readAt) >= readMs) return { written: false };
    await table.put({ ...record, readMs });
    await noteStoredInstant(db, record.snapshot.readAt);
    return { written: true };
  });
}

/**
 * Deletes the record of one observer, account and range, so the range's next pass is a first look (a restarted chain:
 * src/background/calendar-pass.ts); returns whether there was one. One readwrite transaction (the caller's when
 * there is one).
 */
export async function dropCalendarRecord(db: LedgerDb, key: CalendarRecordKey): Promise<boolean> {
  const table = db.calendarSnapshots;
  return db.transaction('rw', table, async (): Promise<boolean> => {
    if ((await table.get(keyOf(key))) === undefined) return false;
    await table.delete(keyOf(key));
    return true;
  });
}

/**
 * Deletes every record whose snapshot was read before `cutoffMs` (src/ledger/retention.ts rule 6). Runs in the
 * caller's transaction when there is one (its scope must include `calendarSnapshots`). Returns how many went.
 */
export async function purgeCalendarRecords(db: LedgerDb, cutoffMs: number): Promise<number> {
  return db.calendarSnapshots.where('readMs').between(Dexie.minKey, cutoffMs, true, false).delete();
}
