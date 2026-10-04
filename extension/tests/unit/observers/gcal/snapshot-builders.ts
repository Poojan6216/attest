/**
 * Hand-built Calendar snapshots of the week Sun 4 to Sat 10 Oct 2026 (src/observers/gcal/snapshot.ts), for the diff
 * tests. Not observer code.
 */
import { hashRowKey, hashText } from '../../../../src/core/redact';
import { CalendarSnapshot, type CalendarSnapshotInput } from '../../../../src/observers/gcal/snapshot';

export const READ_AT = '2026-10-03T12:00:00-04:00';
export const MAIN = hashText('Avery Founder');
export const FAMILY = hashText('Family');
export const DAYS = [
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
];

export type EventInput = CalendarSnapshotInput['events'][number];

/** An event `id` on Tue 6 Oct 10–11am on the main calendar, no guests, with `overrides`. */
export function event(id: string, overrides: Partial<EventInput> = {}): EventInput {
  return {
    key: hashRowKey(id),
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

export interface SnapshotOptions {
  readonly hidden?: readonly string[];
  readonly familyShown?: boolean;
  readonly version?: string;
  readonly days?: readonly string[];
  readonly mainNamedTwice?: boolean;
}

/** The unparsed snapshot of `events` (for schema tests that change one field). */
export function snapshotInput(
  events: readonly EventInput[],
  options: SnapshotOptions = {},
): CalendarSnapshotInput {
  const days = options.days ?? DAYS;
  return {
    format: 1,
    observer: 'gcal.event',
    version: options.version ?? '1.0.0',
    range: `${days[0] ?? ''}/${days[days.length - 1] ?? ''}`,
    readAt: READ_AT,
    baselineAt: READ_AT,
    days: days.map((date) => ({ date, complete: !(options.hidden ?? []).includes(date) })),
    calendars: [
      options.mainNamedTwice === true
        ? { key: MAIN, shown: true, ambiguous: true }
        : { key: MAIN, shown: true },
      { key: FAMILY, shown: options.familyShown ?? false },
    ],
    events: [...events],
  };
}

/** The parsed snapshot of `events`. */
export function snapshot(events: readonly EventInput[], options: SnapshotOptions = {}): CalendarSnapshot {
  return CalendarSnapshot.parse(snapshotInput(events, options));
}
