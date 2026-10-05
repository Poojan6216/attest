/**
 * The Calendar diff (sprint_2 2.5): PURE `diffSnapshots(previous, next)` over two snapshots of one visible range
 * (./snapshot.ts). No DOM, no clock, no I/O. The service worker runs it on every pass (src/background/calendar-step.ts),
 * with the range's stored base as `previous` (the stored form) and the page the pass read as `next` (the page form).
 *
 * `changes` are what the two snapshots imply, compared by event key, only where both snapshots could see:
 *  - `calendar.created`: an event in `next` that `previous` lacks, on a calendar `previous` showed, when `previous`
 *    saw every day of the range whole (no "N more": the event could have been hidden there, then moved);
 *  - `calendar.updated`: an event in both that is not in the same state (`sameEventState`: its start, end, all-day
 *    flag, subject hint, calendar or guests changed); it carries the new fields;
 *  - `calendar.deleted`: an event in `previous` that `next` lacks, on a calendar `next` shows, when `next` sees every
 *    day of the range whole (a missing event may have moved onto a day hidden behind "N more"); it carries the
 *    removed event's fields.
 * An event that appears or disappears because its calendar was switched on or off, or because it sits on, or moved
 * to or from, a day hidden behind "N more", is neither created nor deleted (Hard Rule 5). Nor is one on a calendar
 * whose name the list gives twice (`ambiguous`): which of the two was switched cannot be told.
 *
 * `sightings` are the first sightings of events `previous` could not have seen: every event of the first snapshot
 * of a range (`previous` null, or read under other selectors), of a calendar just switched on (or named twice), or
 * new while `previous` hid a day. Each is a `calendar.created` row with the event as it stands. docs/grading.md §4.1
 * needs them: a `calendar.created` claim is verified only by an event first seen at or after the claim, so the event
 * already on the calendar must have a first sighting too, or a claim to have created it could never be told from a
 * real one. A sighting and a later `calendar.created` of the same event state are the same row (same contentHash),
 * so the ledger keeps the earliest sighting (§10).
 *
 * One row per event, never per guest (Decisions [2.5]): its counterparty is the event's first guest in ASCII-
 * lowercase order (the account left out, ./read.ts), or none. An updated row names the first guest the update
 * added, when it added one. So one created event is one `calendar.created` row and at most one UNASKED receipt.
 * Guests are compared by key (./snapshot.ts `guestKey`), so a stored base needs no guest address but its first.
 *
 * Every row's `rowKey` is the event key (SHA-256 of `data-eventid`), so a deleted row can be built from a stored
 * snapshot alone. Rows are ordered by start instant, then key, then type.
 */
import { instantMs } from '../../core/normalize';
import type { ActionType } from '../../core/schema';
import type { RawRow } from '../types';
import { GcalError } from './errors';
import {
  type CalendarSnapshot,
  guestKey,
  type SnapshotEvent,
  type StoredEvent,
  type StoredSnapshot,
} from './snapshot';

export interface CalendarDiff {
  readonly changes: readonly RawRow[];
  readonly sightings: readonly RawRow[];
}

/** A comparison base: a snapshot as the page showed it, or as the store keeps it. */
export type SnapshotBase = CalendarSnapshot | StoredSnapshot;

/** An event of either form. */
export type CalendarEvent = SnapshotEvent | StoredEvent;

type CalendarType = Extract<ActionType, `calendar.${string}`>;

/** One row before it is written out: its type, the event it describes, and the guest it names. */
interface Entry {
  readonly type: CalendarType;
  readonly event: CalendarEvent;
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

function isPageEvent(event: CalendarEvent): event is SnapshotEvent {
  return 'guests' in event;
}

/** The first guest an event names (ASCII-lowercase order, the account left out), if it has one. */
function firstGuestOf(event: CalendarEvent): string | undefined {
  return isPageEvent(event) ? event.guests[0] : event.firstGuest;
}

/** The keys of an event's guests, ascending (./snapshot.ts `guestKey`). */
function guestKeysOf(event: CalendarEvent): readonly string[] {
  return isPageEvent(event) ? event.guests.map(guestKey).sort() : event.guestKeys;
}

/** The first guest of `next` that `previous` did not have (compared by key, so ASCII case is no change), if any. */
function addedGuest(previous: CalendarEvent, next: SnapshotEvent): string | undefined {
  const had = new Set(guestKeysOf(previous));
  return next.guests.find((guest) => !had.has(guestKey(guest)));
}

function sameInstant(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return instantMs(a) === instantMs(b);
}

/**
 * Whether `a` and `b` are one event in one state: the same key, and every field a change is read from equal (start
 * and end compared as instants, all-day flag, subject hint, calendar, guest count, and the guests compared by key).
 * The one definition of a changed event (TECH-6): the diff reports an update exactly when this is false, and the
 * service worker's check that another range's view held a change first (src/background/calendar-seen.ts) reads it
 * too, so the two can never drift apart. Either form of either event.
 */
export function sameEventState(a: CalendarEvent, b: CalendarEvent): boolean {
  return (
    a.key === b.key &&
    sameInstant(a.occurredAt, b.occurredAt) &&
    sameInstant(a.endAt, b.endAt) &&
    a.allDay === b.allDay &&
    a.subjectHint === b.subjectHint &&
    a.calendar === b.calendar &&
    a.guestCount === b.guestCount &&
    guestKeysOf(a).join('\n') === guestKeysOf(b).join('\n')
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

function sightOf(snapshot: SnapshotBase): Sight {
  return {
    calendars: new Set(snapshot.calendars.filter((c) => c.shown && c.ambiguous !== true).map((c) => c.key)),
    whole: snapshot.days.every((day) => day.complete),
  };
}

/** Whether the snapshot `sight` describes would have shown `event` had it been there. */
function couldSee(sight: Sight, event: CalendarEvent): boolean {
  return sight.whole && sight.calendars.has(event.calendar);
}

function created(event: SnapshotEvent): Entry {
  return { type: 'calendar.created', event, counterparty: event.guests[0] };
}

/**
 * Whether `previous` can be compared with `next` at all: read under the same selectors version (each form's format
 * is one literal, so the schemas already reject any other shape).
 */
function comparable(previous: SnapshotBase | null, next: CalendarSnapshot): previous is SnapshotBase {
  return previous !== null && previous.version === next.version;
}

/**
 * The rows the step from `previous` to `next` implies (see the module comment). Throws `GcalError('range_mismatch')`
 * when the two snapshots are of different ranges: the caller's store is keyed by range, so that is a bug.
 */
export function diffSnapshots(previous: SnapshotBase | null, next: CalendarSnapshot): CalendarDiff {
  if (previous !== null && previous.range !== next.range) throw new GcalError('range_mismatch');
  if (!comparable(previous, next)) {
    const all = next.events.map((event) => created(event));
    return { changes: [], sightings: rowsOf(all) };
  }
  const before = new Map<string, CalendarEvent>(previous.events.map((event) => [event.key, event]));
  const now = new Set(next.events.map((event) => event.key));
  const sawBefore = sightOf(previous);
  const seesNow = sightOf(next);
  const changes: Entry[] = [];
  const sightings: Entry[] = [];
  for (const event of next.events) {
    const was = before.get(event.key);
    if (was === undefined) (couldSee(sawBefore, event) ? changes : sightings).push(created(event));
    else if (!sameEventState(was, event))
      changes.push({
        type: 'calendar.updated',
        event,
        counterparty: addedGuest(was, event) ?? event.guests[0],
      });
  }
  for (const was of previous.events) {
    if (!now.has(was.key) && couldSee(seesNow, was))
      changes.push({ type: 'calendar.deleted', event: was, counterparty: firstGuestOf(was) });
  }
  return { changes: rowsOf(changes), sightings: rowsOf(sightings) };
}
