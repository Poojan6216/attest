/**
 * Properties of the Calendar diff over random snapshots of one week (sprint_2 2.5; Hard Rules 4, 5): a snapshot
 * diffed with itself yields nothing; a first snapshot yields one first sighting per event and no change; with every
 * calendar shown and every day whole on both sides, exactly the added events are created, the removed ones deleted
 * and the changed ones updated, one row per event; nothing an earlier snapshot could not see is ever deleted or
 * created; rows carry only allowlisted fields; and the result is deterministic.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { hashRowKey, hashText } from '../../../../src/core/redact';
import { diffSnapshots, passRows } from '../../../../src/observers/gcal/diff';
import { CalendarSnapshot, type CalendarSnapshotInput } from '../../../../src/observers/gcal/snapshot';

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

const eventArb = (id: number): fc.Arbitrary<EventInput> =>
  fc
    .record({
      day: fc.integer({ min: 0, max: 6 }),
      hour: fc.integer({ min: 8, max: 20 }),
      subject: fc.constantFrom('Sync', 'Review', 'Lunch'),
      guests: fc.subarray(GUESTS),
      family: fc.boolean(),
    })
    .map(({ day, hour, subject, guests, family }) => ({
      key: hashRowKey(`event-${String(id)}`),
      calendar: family ? FAMILY : MAIN,
      subjectHint: subject,
      occurredAt: `${DAYS[day] ?? ''}T${String(hour).padStart(2, '0')}:00:00-04:00`,
      allDay: false,
      days: [DAYS[day] ?? ''],
      guests,
      guestCount: guests.length,
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
        const { changes, sightings } = diffSnapshots(snapshot(was, FULL), snapshot(now, FULL));
        const before = new Map(was.map((e) => [e.key, JSON.stringify(e)]));
        const after = new Map(now.map((e) => [e.key, JSON.stringify(e)]));
        const of = (type: string) =>
          changes
            .filter((r) => r.type === type)
            .map(keyOf)
            .sort();
        expect(of('calendar.created')).toEqual([...after.keys()].filter((k) => !before.has(k)).sort());
        expect(of('calendar.deleted')).toEqual([...before.keys()].filter((k) => !after.has(k)).sort());
        const edited = [...after].filter(([k, e]) => before.has(k) && before.get(k) !== e).map(([k]) => k);
        expect(of('calendar.updated')).toEqual(edited.sort());
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
