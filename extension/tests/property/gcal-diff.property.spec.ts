/**
 * Properties of the Calendar diff over random snapshots of one week (sprint_2 2.5; Hard Rules 4, 5, 7): a snapshot
 * diffed with itself yields nothing; a first snapshot yields one first sighting per event and no change; with every
 * calendar shown and every day whole on both sides, exactly the added events are created, the removed ones deleted
 * and the changed ones updated, one row per event; nothing an earlier snapshot could not see is ever deleted or
 * created; rows carry only allowlisted fields; and the result is deterministic.
 *
 * One event state (TECH-6, SEC-2): the diff reports an update exactly when `sameEventState` says the two states
 * differ, the predicate the service worker's "held first elsewhere" check reads too (src/background/calendar-seen.ts);
 * it is the same whichever form either event is in, and a base kept in the stored form (first guest, guest keys)
 * yields the very rows the page form does. Guests are drawn in random ASCII case: a case change is never a change.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asciiLower } from '../../src/core/normalize';
import { hashRowKey, hashText } from '../../src/core/redact';
import { type CalendarDiff, diffSnapshots, sameEventState } from '../../src/observers/gcal/diff';
import {
  CalendarSnapshot,
  type CalendarSnapshotInput,
  type SnapshotEvent,
  storedEventOf,
  storedSnapshotOf,
} from '../../src/observers/gcal/snapshot';

type EventInput = CalendarSnapshotInput['events'][number];

const DAYS = [
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
];
const MAIN = hashText('Avery Founder');
const FAMILY = hashText('Family');
const GUESTS = ['alex.rivera@example.com', 'morgan.patel@example.com', 'priya.raman@example.org'];
const ALLOWED = new Set(['occurredAt', 'subjectHint', 'counterparty']);

/** Every row a diff reports: the changes, then the first sightings. */
const passRows = (diff: CalendarDiff) => [...diff.changes, ...diff.sightings];

/** Some of the guests, in their order, each in a random ASCII case. */
const guestsArb = fc
  .subarray(GUESTS)
  .chain((guests) =>
    fc.tuple(...guests.map((guest) => fc.boolean().map((upper) => (upper ? guest.toUpperCase() : guest)))),
  );

const eventArb = (id: number): fc.Arbitrary<EventInput> =>
  fc
    .record({
      day: fc.integer({ min: 0, max: 6 }),
      hour: fc.integer({ min: 8, max: 20 }),
      subject: fc.constantFrom('Sync', 'Review', 'Lunch'),
      guests: guestsArb,
      extra: fc.integer({ min: 0, max: 1 }),
      allDay: fc.boolean(),
      family: fc.boolean(),
    })
    .map(({ day, hour, subject, guests, extra, allDay, family }) => ({
      key: hashRowKey(`event-${String(id)}`),
      calendar: family ? FAMILY : MAIN,
      subjectHint: subject,
      occurredAt: `${DAYS[day] ?? ''}T${allDay ? '00' : String(hour).padStart(2, '0')}:00:00-04:00`,
      allDay,
      days: [DAYS[day] ?? ''],
      guests,
      guestCount: guests.length + extra,
    }));

const sightArb = fc.record({ familyShown: fc.boolean(), hidden: fc.subarray(DAYS, { maxLength: 2 }) });
interface Sight {
  readonly familyShown: boolean;
  readonly hidden: readonly string[];
}

function snapshot(events: readonly EventInput[], sight: Sight): CalendarSnapshot {
  const visible = events.filter(
    (e) => (e.calendar === MAIN || sight.familyShown) && e.days.every((d) => !sight.hidden.includes(d)),
  );
  return CalendarSnapshot.parse({
    format: 1,
    observer: 'gcal.event',
    version: '1.0.0',
    range: '2026-10-04/2026-10-10',
    readAt: '2026-10-03T12:00:00-04:00',
    baselineAt: '2026-10-03T12:00:00-04:00',
    days: DAYS.map((date) => ({ date, complete: !sight.hidden.includes(date) })),
    calendars: [
      { key: MAIN, shown: true },
      { key: FAMILY, shown: sight.familyShown },
    ],
    events: visible,
  });
}

/** Up to 8 events with ids 0..7, each present or not. */
const worldArb = fc.array(fc.option(fc.nat(7)), { maxLength: 8 }).chain((ids) => {
  const unique = [...new Set(ids.filter((id): id is number => id !== null))];
  return fc.tuple(...unique.map((id) => eventArb(id)));
});

const FULL: Sight = { familyShown: true, hidden: [] };

const keyOf = (row: { rowKey?: string | undefined }) => row.rowKey ?? '';

/** An event state as these generators vary it, guests ASCII-folded: two states differ exactly when this does. */
const stateOf = (e: SnapshotEvent): string => JSON.stringify({ ...e, guests: e.guests.map(asciiLower) });

describe('diff properties', () => {
  it('a snapshot diffed with itself yields nothing; a first one, one sighting per event', () => {
    fc.assert(
      fc.property(worldArb, sightArb, (events, sight) => {
        const s = snapshot(events, sight);
        expect(passRows(diffSnapshots(s, s))).toEqual([]);
        const first = diffSnapshots(null, s);
        expect(first.changes).toEqual([]);
        expect(first.sightings.map(keyOf).sort()).toEqual(s.events.map((e) => e.key).sort());
      }),
    );
  });

  it('with everything visible on both sides: created, deleted and updated are exactly the set differences', () => {
    fc.assert(
      fc.property(worldArb, worldArb, (was, now) => {
        const previous = snapshot(was, FULL);
        const next = snapshot(now, FULL);
        const { changes, sightings } = diffSnapshots(previous, next);
        const before = new Map(previous.events.map((e) => [e.key, e]));
        const after = new Map(next.events.map((e) => [e.key, e]));
        const of = (type: string) =>
          changes
            .filter((r) => r.type === type)
            .map(keyOf)
            .sort();
        expect(of('calendar.created')).toEqual([...after.keys()].filter((k) => !before.has(k)).sort());
        expect(of('calendar.deleted')).toEqual([...before.keys()].filter((k) => !after.has(k)).sort());
        const edited = [...after].filter(([k, e]) => {
          const was = before.get(k);
          return was !== undefined && stateOf(was) !== stateOf(e);
        });
        expect(of('calendar.updated')).toEqual(edited.map(([k]) => k).sort());
        expect(sightings).toEqual([]);
        expect(new Set(changes.map(keyOf)).size).toBe(changes.length);
      }),
    );
  });
});

describe('diff properties: what could not be seen, and the rows', () => {
  it('the same calendar seen with other calendars or days hidden: no change, only first sightings', () => {
    fc.assert(
      fc.property(worldArb, sightArb, sightArb, (events, a, b) => {
        const previous = snapshot(events, a);
        const next = snapshot(events, b);
        const { changes, sightings } = diffSnapshots(previous, next);
        expect(changes).toEqual([]);
        const unseen = next.events.filter((e) => !previous.events.some((p) => p.key === e.key));
        expect(sightings.map(keyOf).sort()).toEqual(unseen.map((e) => e.key).sort());
      }),
    );
  });

  it('a snapshot that hid any day vouches for no absence: nothing is created after it, nothing deleted by it', () => {
    fc.assert(
      fc.property(worldArb, worldArb, sightArb, sightArb, (was, now, a, b) => {
        const { changes } = diffSnapshots(snapshot(was, a), snapshot(now, b));
        const types = new Set(changes.map((row) => row.type));
        if (a.hidden.length > 0) expect(types.has('calendar.created')).toBe(false);
        if (b.hidden.length > 0) expect(types.has('calendar.deleted')).toBe(false);
      }),
    );
  });

  it('rows carry only allowlisted fields, and the same inputs give the same rows', () => {
    fc.assert(
      fc.property(worldArb, worldArb, sightArb, (was, now, sight) => {
        const previous = snapshot(was, sight);
        const next = snapshot(now, sight);
        const rows = passRows(diffSnapshots(previous, next));
        for (const row of rows) expect(Object.keys(row.fields).filter((k) => !ALLOWED.has(k))).toEqual([]);
        expect(passRows(diffSnapshots(previous, next))).toEqual(rows);
      }),
    );
  });
});

/** Two states of one event (the same key), each drawn on its own. */
const statesArb = fc.tuple(eventArb(0), eventArb(0)).map(([a, b]) => {
  const parsed = snapshot([a], FULL).events[0];
  const other = snapshot([b], FULL).events[0];
  if (parsed === undefined || other === undefined) throw new Error('no event');
  return [parsed, other] as const;
});

/** One event state and a copy that differs in at most one field (a guest's ASCII case is one of the ways). */
const nearStatesArb = fc
  .tuple(
    eventArb(0),
    fc.constantFrom('same', 'case', 'count', 'subject', 'hour', 'allDay', 'calendar', 'guest'),
  )
  .map(([input, change]) => {
    const was = snapshot([input], FULL).events[0];
    if (was === undefined) throw new Error('no event');
    const swapCase = (guest: string) =>
      guest === guest.toUpperCase() ? guest.toLowerCase() : guest.toUpperCase();
    const changed: Record<string, Partial<EventInput>> = {
      same: {},
      case: { guests: was.guests.map(swapCase) },
      count: { guestCount: was.guestCount + 1 },
      subject: { subjectHint: `${was.subjectHint ?? ''} (moved)` },
      hour: { occurredAt: was.occurredAt.replace(/T\d{2}/u, 'T21') },
      allDay: { allDay: !was.allDay },
      calendar: { calendar: was.calendar === MAIN ? FAMILY : MAIN },
      guest: { guests: was.guests.slice(1), guestCount: Math.max(0, was.guestCount - 1) },
    };
    const now = snapshot([{ ...input, ...changed[change] }], FULL).events[0];
    if (now === undefined) throw new Error('no event');
    return [was, now] as const;
  });

/** The update the diff reports between two states of one event, if any. */
function updateBetween(was: SnapshotEvent, now: SnapshotEvent): boolean {
  const { changes } = diffSnapshots(snapshot([was], FULL), snapshot([now], FULL));
  return changes.some((row) => row.type === 'calendar.updated');
}

describe('one event state, shared by the diff and the service worker (TECH-6, SEC-2)', () => {
  it('the diff reports an update exactly when sameEventState says the states differ, and only then', () => {
    fc.assert(
      fc.property(fc.oneof(statesArb, nearStatesArb), ([was, now]) => {
        expect(sameEventState(was, now)).toBe(stateOf(was) === stateOf(now));
        expect(updateBetween(was, now)).toBe(!sameEventState(was, now));
      }),
      { numRuns: 400 },
    );
  });

  it('sameEventState is reflexive and symmetric, and the same whichever form either event is in', () => {
    fc.assert(
      fc.property(statesArb, ([a, b]) => {
        expect(sameEventState(a, a)).toBe(true);
        expect(sameEventState(storedEventOf(a), a)).toBe(true);
        const same = sameEventState(a, b);
        expect(sameEventState(b, a)).toBe(same);
        expect(sameEventState(storedEventOf(a), b)).toBe(same);
        expect(sameEventState(a, storedEventOf(b))).toBe(same);
        expect(sameEventState(storedEventOf(a), storedEventOf(b))).toBe(same);
      }),
      { numRuns: 300 },
    );
  });

  it('a base kept in the stored form yields the very rows the page form does', () => {
    fc.assert(
      fc.property(worldArb, worldArb, sightArb, sightArb, (was, now, a, b) => {
        const previous = snapshot(was, a);
        const next = snapshot(now, b);
        expect(diffSnapshots(storedSnapshotOf(previous), next)).toEqual(diffSnapshots(previous, next));
      }),
    );
  });
});
