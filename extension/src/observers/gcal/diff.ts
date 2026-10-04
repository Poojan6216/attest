/**
 * The Calendar diff (sprint_2 2.5): PURE `diffSnapshots(previous, next)` over two snapshots of one visible range
 * (./snapshot.ts). No DOM, no clock, no I/O.
 *
 * `changes` are what the two snapshots imply, compared by event key, only where both snapshots could see:
 *  - `calendar.created`: an event in `next` that `previous` lacks, on a calendar `previous` showed, when `previous`
 *    saw every day of the range whole (no "N more": the event could have been hidden there, then moved);
 *  - `calendar.updated`: an event in both whose start, end, all-day flag, subject hint, calendar or guests changed;
 *    it carries the new fields;
 *  - `calendar.deleted`: an event in `previous` that `next` lacks, on a calendar `next` shows, when `next` sees every
 *    day of the range whole (a missing event may have moved onto a day hidden behind "N more"); it carries the
 *    removed event's fields.
 * An event that appears or disappears because its calendar was switched on or off, or because it sits on, or moved
 * to or from, a day hidden behind "N more", is neither created nor deleted (Hard Rule 5). Nor is one on a calendar
 * whose name the list gives twice (`ambiguous`): which of the two was switched cannot be told.
 *
 * `sightings` are the first sightings of events `previous` could not have seen: every event of the first snapshot
 * of a range (`previous` null, or read under other selectors), of a calendar just switched on (or named twice), or
 * new while `previous` hid a day. Each is a `calendar.created` row with the event as it stands. docs/grading.md §4.1 needs them: a
 * `calendar.created` claim is verified only by an event first seen at or after the claim, so the event already on
 * the calendar must have a first sighting too, or a claim to have created it could never be told from a real one.
 * A sighting and a later `calendar.created` of the same event state are the same row (same contentHash), so the
 * ledger keeps the earliest sighting (§10).
 *
 * One row per event, never per guest (Decisions [2.5]): its counterparty is the event's first guest in ASCII-
 * lowercase order (the account left out, ./read.ts), or none. An updated row names the first guest the update
 * added, when it added one. So one created event is one `calendar.created` row and at most one UNASKED receipt.
 *
 * Every row's `rowKey` is the event key (SHA-256 of `data-eventid`), so a deleted row can be built from a stored
 * snapshot alone. Rows are ordered by start instant, then key, then type.
 */
import { asciiLower, instantMs } from '../../core/normalize';
import type { ActionType } from '../../core/schema';
import type { RawRow } from '../types';
import { GcalError } from './errors';
import type { CalendarSnapshot, SnapshotEvent } from './snapshot';

export interface CalendarDiff {
  readonly changes: readonly RawRow[];
  readonly sightings: readonly RawRow[];
}

type CalendarType = Extract<ActionType, `calendar.${string}`>;

/** One row before it is written out: its type, the event it describes, and the guest it names. */
interface Entry {
  readonly type: CalendarType;
  readonly event: SnapshotEvent;
  readonly counterparty: string | undefined;
}

const TYPE_ORDER: Readonly<Record<CalendarType, number>> = {
  'calendar.created': 0,
  'calendar.updated': 1,
  'calendar.deleted': 2,
};

/** The fields a row carries: only what the gcal.event allowlist names, each present only when known. */
function rowOf({ type, event, counterparty }: Entry): RawRow {
  return {
    type,
    rowKey: event.key,
    fields: {
      occurredAt: event.occurredAt,
      ...(event.subjectHint === undefined ? {} : { subjectHint: event.subjectHint }),
      ...(counterparty === undefined ? {} : { counterparty }),
    },
  };
}

/** Rows in a fixed order: start instant, then event key, then type (created, updated, deleted). */
function rowsOf(entries: Entry[]): RawRow[] {
  const keyed = entries.map((entry) => ({ entry, ms: instantMs(entry.event.occurredAt) }));
  keyed.sort(
    (a, b) =>
      a.ms - b.ms ||
      (a.entry.event.key < b.entry.event.key ? -1 : a.entry.event.key > b.entry.event.key ? 1 : 0) ||
      TYPE_ORDER[a.entry.type] - TYPE_ORDER[b.entry.type],
  );
  return keyed.map(({ entry }) => rowOf(entry));
}

function folded(guests: readonly string[]): string[] {
  return guests.map(asciiLower);
}

/** The first guest of `next` that `previous` did not have (ASCII case folded), if any. */
function addedGuest(previous: SnapshotEvent, next: SnapshotEvent): string | undefined {
  const had = new Set(folded(previous.guests));
  return next.guests.find((guest) => !had.has(asciiLower(guest)));
}

function sameInstant(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return instantMs(a) === instantMs(b);
}

function changed(previous: SnapshotEvent, next: SnapshotEvent): boolean {
  return (
    !sameInstant(previous.occurredAt, next.occurredAt) ||
    !sameInstant(previous.endAt, next.endAt) ||
    previous.allDay !== next.allDay ||
    previous.subjectHint !== next.subjectHint ||
    previous.calendar !== next.calendar ||
    previous.guestCount !== next.guestCount ||
    folded(previous.guests).join('\n') !== folded(next.guests).join('\n')
  );
}

/**
 * What a snapshot could vouch for: its shown calendars that the list names once, and whether it saw every day of
 * the range whole. An event missing from a snapshot that hid any day behind "N more" may sit there (it may have been
 * moved there), so its absence anywhere in the range says nothing.
 */
interface Sight {
  readonly calendars: ReadonlySet<string>;
  readonly whole: boolean;
}

function sightOf(snapshot: CalendarSnapshot): Sight {
  return {
    calendars: new Set(snapshot.calendars.filter((c) => c.shown && c.ambiguous !== true).map((c) => c.key)),
    whole: snapshot.days.every((day) => day.complete),
  };
}

/** Whether the snapshot `sight` describes would have shown `event` had it been there. */
function couldSee(sight: Sight, event: SnapshotEvent): boolean {
  return sight.whole && sight.calendars.has(event.calendar);
}

function created(event: SnapshotEvent): Entry {
  return { type: 'calendar.created', event, counterparty: event.guests[0] };
}

/**
 * Whether `previous` can be compared with `next` at all: read under the same selectors version (the snapshot
 * format is one literal, so the schema already rejects another).
 */
function comparable(previous: CalendarSnapshot | null, next: CalendarSnapshot): previous is CalendarSnapshot {
  return previous !== null && previous.version === next.version;
}

/**
 * The rows the step from `previous` to `next` implies (see the module comment). Throws `GcalError('range_mismatch')`
 * when the two snapshots are of different ranges: the caller's store is keyed by range, so that is a bug.
 */
export function diffSnapshots(previous: CalendarSnapshot | null, next: CalendarSnapshot): CalendarDiff {
  if (previous !== null && previous.range !== next.range) throw new GcalError('range_mismatch');
  if (!comparable(previous, next)) {
    const all = next.events.map((event) => created(event));
    return { changes: [], sightings: rowsOf(all) };
  }
  const before = new Map(previous.events.map((event) => [event.key, event]));
  const now = new Set(next.events.map((event) => event.key));
  const sawBefore = sightOf(previous);
  const seesNow = sightOf(next);
  const changes: Entry[] = [];
  const sightings: Entry[] = [];
  for (const event of next.events) {
    const was = before.get(event.key);
    if (was === undefined) (couldSee(sawBefore, event) ? changes : sightings).push(created(event));
    else if (changed(was, event))
      changes.push({
        type: 'calendar.updated',
        event,
        counterparty: addedGuest(was, event) ?? event.guests[0],
      });
  }
  for (const was of previous.events) {
    if (!now.has(was.key) && couldSee(seesNow, was))
      changes.push({ type: 'calendar.deleted', event: was, counterparty: was.guests[0] });
  }
  return { changes: rowsOf(changes), sightings: rowsOf(sightings) };
}

/** Every row one pass reports: the changes, then the first sightings. */
export function passRows(diff: CalendarDiff): RawRow[] {
  return [...diff.changes, ...diff.sightings];
}
