/**
 * The Calendar snapshot store's record schema (sprint_2 2.7; ./calendar-snapshots.ts has the store): a range's
 * comparison base and what it could not vouch for. Moved out of the store in the Sprint 5 close (tech review TECH-1),
 * so a page that reads records (the export, src/ledger/export-file.ts) bundles the schema and not the store's writers.
 */
import { z } from 'zod';

import { CalendarSnapshot, RangeKey, StoredSnapshot, storedSnapshotOf } from '../observers/gcal/snapshot';
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
