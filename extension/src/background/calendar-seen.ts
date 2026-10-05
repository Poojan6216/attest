/**
 * Changes another range saw first (docs/grading.md §3 orphans, §7; Decisions [2.7] wave D; Hard Rule 7).
 *
 * Snapshots are stored per range (src/ledger/calendar-snapshots.ts) and rows carry no range: an event created, moved
 * or edited on a day two ranges show (a week and its month, two accounts) reaches each range's chain on its own. When
 * this range's chain reports the change, at this pass, another range's stored view may already have held the event
 * in its new state, read after this range's base and before this pass. Then the change happened before that read:
 * this pass is not when it was first seen, and an agent active at this pass would be named for a change made earlier
 * (an event already on the calendar, read as a change Attest saw happen). Such a row is stored as a first sighting,
 * with its first-look marker (src/ledger/first-look.ts), so it never accuses an agent: a missed UNASKED at worst,
 * never a false one. The range that saw the new state first reported it itself, as a change its own chain followed
 * (that row stands) or as a first sighting.
 *
 * Only a creation or an update can be seen first elsewhere; a confirmed deletion reports an absence. The other
 * record must be read strictly after this range's base and strictly before this pass: one read at or before the base
 * says nothing about the change since, and one read at this pass's instant cannot be ordered with it.
 */
import { asciiLower, instantMs } from '../core/normalize';
import { CalendarRecord, type CalendarRecordKey } from '../ledger/calendar-snapshots';
import { readRows, type LedgerDb } from '../ledger/db';
import type { CalendarSnapshot, SnapshotEvent } from '../observers/gcal/snapshot';
import type { CalendarRow } from './calendar-step';

const sameInstant = (a: string | undefined, b: string | undefined): boolean =>
  a === undefined || b === undefined ? a === b : instantMs(a) === instantMs(b);

/** Whether two snapshots hold an event in one state (every field the diff compares, src/observers/gcal/diff.ts). */
export function sameState(a: SnapshotEvent, b: SnapshotEvent): boolean {
  return (
    a.key === b.key &&
    sameInstant(a.occurredAt, b.occurredAt) &&
    sameInstant(a.endAt, b.endAt) &&
    a.allDay === b.allDay &&
    a.subjectHint === b.subjectHint &&
    a.calendar === b.calendar &&
    a.guestCount === b.guestCount &&
    a.guests.map(asciiLower).join('\n') === b.guests.map(asciiLower).join('\n')
  );
}

/** The stored records of other ranges (any account) read strictly between `afterMs` and `beforeMs`. */
async function otherViews(
  db: LedgerDb,
  key: CalendarRecordKey,
  afterMs: number,
  beforeMs: number,
): Promise<CalendarRecord[]> {
  // An empty span (a base not before the pass, which calendar-pass.ts skips as late) has no view in it.
  if (afterMs >= beforeMs) return [];
  const rows = await db.calendarSnapshots.where('readMs').between(afterMs, beforeMs, false, false).toArray();
  return readRows('calendarSnapshots', CalendarRecord, rows).filter(
    (record) =>
      record.observerId === key.observerId &&
      !(record.accountHash === key.accountHash && record.range === key.range),
  );
}

/**
 * `rows` with each creation or update another range's view held first (see the header) turned into a first
 * sighting. `base` is the record this pass was compared with (null for a first look: every row is one already).
 * Reads inside the caller's transaction (the pass's, src/ledger/first-look.ts `inCalendarPass`).
 */
export async function seenFirstElsewhere(
  db: LedgerDb,
  key: CalendarRecordKey,
  base: CalendarRecord | null,
  next: CalendarSnapshot,
  rows: readonly CalendarRow[],
): Promise<CalendarRow[]> {
  const changes = rows.filter((each) => !each.firstSighting && each.row.type !== 'calendar.deleted');
  if (base === null || changes.length === 0) return [...rows];
  const views = await otherViews(db, key, instantMs(base.snapshot.readAt), instantMs(next.readAt));
  if (views.length === 0) return [...rows];
  const now = new Map<string, SnapshotEvent>(next.events.map((event) => [event.key, event]));
  const heldFirst = (row: CalendarRow): boolean => {
    const state = row.row.rowKey === undefined ? undefined : now.get(row.row.rowKey);
    if (state === undefined) return false;
    return views.some((view) => view.snapshot.events.some((event) => sameState(event, state)));
  };
  return rows.map((each) =>
    changes.includes(each) && heldFirst(each) ? { ...each, firstSighting: true } : each,
  );
}
