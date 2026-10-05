/**
 * Hand-built Calendar snapshots of the week Sun 4 to Sat 10 Oct 2026 (src/observers/gcal/snapshot.ts) and the
 * records the service worker stores for them (src/ledger/calendar-snapshots.ts), for the Calendar pass tests.
 */
import { hashRowKey, hashText } from '../../../src/core/redact';
import { IsoTs, Sha256 } from '../../../src/core/schema';
import type { CalendarRecord, PendingAbsence } from '../../../src/ledger/calendar-snapshots';
import { CalendarSnapshot, type CalendarSnapshotInput } from '../../../src/observers/gcal/snapshot';

export const MAIN = hashText('Avery Founder');
export const FAMILY = hashText('Family');
export const ACCOUNT = Sha256.parse('9a'.repeat(32));
export const DAYS = ['04', '05', '06', '07', '08', '09', '10'].map((day) => `2026-10-${day}`);
export const RANGE = '2026-10-04/2026-10-10';
export const VERSION = '1.2.0';

/** Noon on Sat 3 Oct 2026 plus `minutes`, written in New York's offset: a pass instant. */
export function at(minutes: number): IsoTs {
  const ms = Date.parse('2026-10-03T16:00:00Z') + minutes * 60_000;
  const local = new Date(ms - 4 * 3_600_000).toISOString().slice(0, 23);
  return IsoTs.parse(`${local}-04:00`);
}

export type EventInput = CalendarSnapshotInput['events'][number];

/** The key of event `id` (SHA-256 of its `data-eventid`). */
export const keyOf = (id: string): Sha256 => hashRowKey(id);

/** Event `id` on Tue 6 Oct 10–11am on the main calendar, no guests, with `overrides`. */
export function event(id: string, overrides: Partial<EventInput> = {}): EventInput {
  return {
    key: keyOf(id),
    calendar: MAIN,
    subjectHint: `Event ${id}`,
    occurredAt: '2026-10-06T10:00:00-04:00',
    endAt: '2026-10-06T11:00:00-04:00',
    allDay: false,
    days: ['2026-10-06'],
    guests: [],
    guestCount: 0,
    ...overrides,
  };
}

export interface WeekOptions {
  readonly readAt?: IsoTs;
  /** Days that hide events behind "N more". */
  readonly hidden?: readonly string[];
  readonly familyShown?: boolean;
  readonly mainNamedTwice?: boolean;
  readonly version?: string;
}

/** The week's snapshot of `events`, read at `options.readAt` (a first look: its baseline is its own read). */
export function week(events: readonly EventInput[], options: WeekOptions = {}): CalendarSnapshot {
  const readAt = options.readAt ?? at(0);
  return CalendarSnapshot.parse({
    format: 1,
    observer: 'gcal.event',
    version: options.version ?? VERSION,
    range: RANGE,
    readAt,
    baselineAt: readAt,
    days: DAYS.map((date) => ({ date, complete: !(options.hidden ?? []).includes(date) })),
    calendars: [
      options.mainNamedTwice === true
        ? { key: MAIN, shown: true, ambiguous: true }
        : { key: MAIN, shown: true },
      { key: FAMILY, shown: options.familyShown ?? false },
    ],
    events: [...events],
  });
}

/** The record the service worker would store for `snapshot`, waiting on `pending`. */
export function record(snapshot: CalendarSnapshot, pending: readonly PendingAbsence[] = []): CalendarRecord {
  return {
    observerId: 'gcal.event',
    accountHash: ACCOUNT,
    range: snapshot.range,
    snapshot,
    pending: [...pending],
  };
}
