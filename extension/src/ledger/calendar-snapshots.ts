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
import { z } from 'zod';

import { instantMs } from '../core/normalize';
import { CalendarSnapshot, RangeKey, StoredSnapshot, storedSnapshotOf } from '../observers/gcal/snapshot';
import { noteStoredInstant } from './clock-high-water';
import { readRow, type CalendarKey, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { ComponentId, IsoTs, SCHEMA_LIMITS, Sha256 } from './types';

/**
 * An event of the record's snapshot absent once from a snapshot that could see it, since that snapshot's read, and
 * `baseAt`, the read of the snapshot that first absence was compared with: the deletion happened between the two, so
 * the service worker can tell a deletion noticed long after it happened (src/background/calendar-step.ts). Optional:
 * a record stored before wave E has none, and its deletion is then read as noticed late.
 */
export const PendingAbsence = z.strictObject({ key: Sha256, since: IsoTs, baseAt: IsoTs.optional() });

/**
 * The `calendar.updated` rows reported for one event of the record's snapshot in its current churn window: `count`
 * of them since `since`, the first one's instant (SEC-11).
 */
export const UpdateWindow = z.strictObject({ key: Sha256, since: IsoTs, count: z.number().int().min(1) });

/** A record's snapshot, always kept in its stored form; a page-form snapshot is read as its stored form. */
const RecordSnapshot = z.union([StoredSnapshot, CalendarSnapshot.transform(storedSnapshotOf)]);

/** Each entry of `list` names one event of `keys`, at most once. */
function keyProblems(
  list: readonly { readonly key: string }[],
  keys: ReadonlySet<string>,
  path: 'pending' | 'updates',
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    if (!keys.has(entry.key) || seen.has(entry.key)) {
      ctx.addIssue({ code: 'custom', path: [path, i, 'key'], message: 'must name one snapshot event' });
    }
    seen.add(entry.key);
  });
}

export const CalendarRecord = z
  .strictObject({
    observerId: ComponentId,
    accountHash: Sha256,
    range: RangeKey,
    /** The range's comparison base: the latest snapshot, plus the events it could not vouch for (see the header). */
    snapshot: RecordSnapshot,
    pending: z.array(PendingAbsence).max(SCHEMA_LIMITS.BATCH),
    updates: z.array(UpdateWindow).max(SCHEMA_LIMITS.BATCH).default([]),
  })
  .superRefine((record, ctx) => {
    if (record.snapshot.range !== record.range) {
      ctx.addIssue({ code: 'custom', path: ['range'], message: 'must be the snapshot range' });
    }
    const keys = new Set(record.snapshot.events.map((event) => event.key));
    keyProblems(record.pending, keys, 'pending', ctx);
    keyProblems(record.updates, keys, 'updates', ctx);
  });

export type PendingAbsence = z.infer<typeof PendingAbsence>;
export type UpdateWindow = z.infer<typeof UpdateWindow>;
export type CalendarRecord = z.infer<typeof CalendarRecord>;
export type CalendarRecordInput = z.input<typeof CalendarRecord>;

/** A stored record: the record plus its derived `readMs` (INDEX_FIELDS.calendarSnapshots). */
export type CalendarRecordRow = CalendarRecord & { readonly readMs: number };

export interface CalendarRecordKey {
  readonly observerId: string;
  readonly accountHash: string;
  readonly range: string;
}

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
