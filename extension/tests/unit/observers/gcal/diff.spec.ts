/**
 * The Calendar diff (sprint_2 2.5 Done-when): before/after fixtures produce exactly one `calendar.created`, an
 * unchanged view zero, a removed event `calendar.deleted`, an edited event `calendar.updated`; a calendar switched
 * on or off creates and deletes nothing (Hard Rule 5). Every labelled diff is reproduced exactly, compared by
 * contentHash after `project()`. Then the rules one by one on hand-built snapshots: first sightings, "N more" days,
 * guests (one row per event, Decisions [2.5]), selector versions, and ranges.
 */
import { describe, expect, it } from 'vitest';

import { type CalendarDiff, diffSnapshots } from '../../../../src/observers/gcal/diff';
import { GcalError } from '../../../../src/observers/gcal/errors';
import { CalendarSnapshot } from '../../../../src/observers/gcal/snapshot';
import { expectedObservation, fixture, GCAL_FIXTURES, projectRows, snapshotOfFixture } from './gcal-fixtures';
import { type EventInput, event, FAMILY, MAIN, READ_AT, snapshot } from './snapshot-builders';

/** Every row a diff reports: the changes, then the first sightings. */
const passRows = (diff: CalendarDiff) => [...diff.changes, ...diff.sightings];

function hashes(observations: readonly { contentHash: string }[]): string[] {
  return observations.map((o) => o.contentHash).sort();
}

describe('the labelled diffs', () => {
  const diffs = GCAL_FIXTURES.flatMap((f) => f.diffs.map((d) => [`${d.from} → ${f.file}`, f, d] as const));

  it.each(diffs)('%s: exactly the labelled changes', (_, f, d) => {
    const previous = snapshotOfFixture(fixture(d.from));
    const { changes } = diffSnapshots(previous, snapshotOfFixture(f));
    const got = projectRows(changes, f.page.readAt);
    const want = d.observations.map((o) => expectedObservation(o, f.page.readAt));
    expect(hashes(got)).toEqual(hashes(want));
  });

  it('before → after-create: exactly one calendar.created, and nothing else in the pass', () => {
    const next = snapshotOfFixture(fixture('synthetic-gcal-week-after-create.html'));
    const diff = diffSnapshots(snapshotOfFixture(fixture('synthetic-gcal-week-before.html')), next);
    expect(diff.changes.map((row) => row.type)).toEqual(['calendar.created']);
    expect(diff.sightings).toEqual([]);
    expect(passRows(diff)).toHaveLength(1);
  });

  it('after-create → unchanged: zero rows (a new page load with new class names)', () => {
    const previous = snapshotOfFixture(fixture('synthetic-gcal-week-after-create.html'));
    const diff = diffSnapshots(previous, snapshotOfFixture(fixture('synthetic-gcal-week-unchanged.html')));
    expect(passRows(diff)).toEqual([]);
  });

  it('unchanged → after-edit: one calendar.updated with the new start', () => {
    const previous = snapshotOfFixture(fixture('synthetic-gcal-week-unchanged.html'));
    const { changes, sightings } = diffSnapshots(
      previous,
      snapshotOfFixture(fixture('synthetic-gcal-week-after-edit.html')),
    );
    expect(changes.map((row) => [row.type, row.fields])).toEqual([
      [
        'calendar.updated',
        {
          occurredAt: '2026-10-08T15:00:00-04:00',
          subjectHint: 'Design review with Priya',
          counterparty: 'priya.raman@example.org',
        },
      ],
    ]);
    expect(sightings).toEqual([]);
  });
});

describe('the labelled diffs: deletes, calendars switched, first sightings', () => {
  it('after-edit → after-delete: one calendar.deleted carrying the removed event', () => {
    const previous = snapshotOfFixture(fixture('synthetic-gcal-week-after-edit.html'));
    const { changes } = diffSnapshots(
      previous,
      snapshotOfFixture(fixture('synthetic-gcal-week-after-delete.html')),
    );
    expect(changes.map((row) => [row.type, row.fields])).toEqual([
      [
        'calendar.deleted',
        {
          occurredAt: '2026-10-07T14:00:00-04:00',
          subjectHint: 'Investor call',
          counterparty: 'morgan.patel@example.com',
        },
      ],
    ]);
  });

  it('a calendar switched on: no change, its events are first sightings; switched off: nothing', () => {
    const on = diffSnapshots(
      snapshotOfFixture(fixture('synthetic-gcal-week-after-delete.html')),
      snapshotOfFixture(fixture('synthetic-gcal-week-two-calendars.html')),
    );
    expect(on.changes).toEqual([]);
    expect(on.sightings.map((row) => row.type)).toEqual(['calendar.created', 'calendar.created']);
    const off = diffSnapshots(
      snapshotOfFixture(fixture('synthetic-gcal-week-two-calendars.html')),
      snapshotOfFixture(fixture('synthetic-gcal-week-family-hidden.html')),
    );
    expect(passRows(off)).toEqual([]);
  });

  it('the first snapshot of a range: every event is a first sighting, none is a change', () => {
    const f = fixture('synthetic-gcal-week-before.html');
    const diff = diffSnapshots(null, snapshotOfFixture(f));
    expect(diff.changes).toEqual([]);
    expect(diff.sightings).toHaveLength(f.events.length);
    expect(new Set(diff.sightings.map((row) => row.type))).toEqual(new Set(['calendar.created']));
  });

  it('a first sighting and a later created row of the same event state are one observation (same contentHash)', () => {
    const before = snapshotOfFixture(fixture('synthetic-gcal-week-before.html'));
    const after = snapshotOfFixture(fixture('synthetic-gcal-week-after-create.html'));
    const created = projectRows(diffSnapshots(before, after).changes, READ_AT);
    const sighted = projectRows(diffSnapshots(null, after).sightings, READ_AT);
    expect(hashes(sighted)).toEqual(expect.arrayContaining(hashes(created)));
  });
});

describe('diff rules: what each snapshot could see', () => {
  it('an event added on a day the previous snapshot hid behind "N more" is a sighting, not created', () => {
    const diff = diffSnapshots(snapshot([], { hidden: ['2026-10-06'] }), snapshot([event('a')]));
    expect(diff.changes).toEqual([]);
    expect(diff.sightings.map((row) => row.type)).toEqual(['calendar.created']);
  });

  it('an event missing from a day now hidden behind "N more" is not deleted', () => {
    const diff = diffSnapshots(snapshot([event('a')]), snapshot([], { hidden: ['2026-10-06'] }));
    expect(passRows(diff)).toEqual([]);
  });

  it('an event missing while next hides any day behind "N more" is not deleted: it may have moved there', () => {
    const diff = diffSnapshots(snapshot([event('a')]), snapshot([], { hidden: ['2026-10-09'] }));
    expect(passRows(diff)).toEqual([]);
  });

  it('an event new while previous hid any day is a first sighting, not created: it may have moved from there', () => {
    const diff = diffSnapshots(snapshot([], { hidden: ['2026-10-09'] }), snapshot([event('a')]));
    expect(diff.changes).toEqual([]);
    expect(diff.sightings.map((row) => row.type)).toEqual(['calendar.created']);
  });

  it('a calendar the list names twice: no created or deleted on it (which one was switched?), updates still seen', () => {
    const twice = { mainNamedTwice: true };
    expect(passRows(diffSnapshots(snapshot([event('a')], twice), snapshot([], twice)))).toEqual([]);
    const appeared = diffSnapshots(snapshot([], twice), snapshot([event('a')], twice));
    expect([appeared.changes, appeared.sightings.map((row) => row.type)]).toEqual([[], ['calendar.created']]);
    const moved = event('a', { occurredAt: '2026-10-06T12:00:00-04:00', endAt: '2026-10-06T13:00:00-04:00' });
    const updated = diffSnapshots(snapshot([event('a')], twice), snapshot([moved], twice));
    expect(updated.changes.map((row) => row.type)).toEqual(['calendar.updated']);
  });
});

describe('diff rules: days seen whole, and guests', () => {
  it('an event drawn over two days is deleted only when both days are seen whole', () => {
    const late = event('late', { days: ['2026-10-07', '2026-10-08'] });
    expect(passRows(diffSnapshots(snapshot([late]), snapshot([], { hidden: ['2026-10-08'] })))).toEqual([]);
    expect(diffSnapshots(snapshot([late]), snapshot([])).changes.map((row) => row.type)).toEqual([
      'calendar.deleted',
    ]);
  });

  it('several guests: one row, naming the first guest in ASCII-lowercase order', () => {
    const guests = ['alex.rivera@example.com', 'Priya.Raman@example.org'];
    const diff = diffSnapshots(snapshot([]), snapshot([event('a', { guests, guestCount: 2 })]));
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]?.fields).toMatchObject({ counterparty: 'alex.rivera@example.com' });
  });

  it('an update that adds a guest names the guest it added', () => {
    const was = event('a', { guests: ['priya.raman@example.org'], guestCount: 1 });
    const now = event('a', { guests: ['alex.rivera@example.com', 'priya.raman@example.org'], guestCount: 2 });
    const { changes } = diffSnapshots(snapshot([was]), snapshot([now]));
    expect(changes.map((row) => [row.type, row.fields])).toEqual([
      ['calendar.updated', expect.objectContaining({ counterparty: 'alex.rivera@example.com' })],
    ]);
  });

  it.each([
    ['the end moved', { endAt: '2026-10-06T11:30:00-04:00' }],
    ['the subject changed', { subjectHint: 'Renamed' }],
    ['it became all day', { allDay: true, occurredAt: '2026-10-06T00:00:00-04:00' }],
    ['a guest left', { guests: [], guestCount: 0 }],
  ])('an update is reported when %s', (_, overrides) => {
    const was = event('a', { guests: ['priya.raman@example.org'], guestCount: 1 });
    const { changes } = diffSnapshots(snapshot([was]), snapshot([{ ...was, ...overrides }]));
    expect(changes.map((row) => row.type)).toEqual(['calendar.updated']);
  });
});

describe('diff rules: what counts as a change', () => {
  it('the same instants written in another offset, and guests in another case, are no change', () => {
    const was = event('a', { guests: ['priya.raman@example.org'], guestCount: 1 });
    const now = event('a', {
      occurredAt: '2026-10-06T14:00:00Z',
      endAt: '2026-10-06T15:00:00Z',
      guests: ['Priya.Raman@Example.org'],
      guestCount: 1,
    });
    expect(passRows(diffSnapshots(snapshot([was]), snapshot([now])))).toEqual([]);
  });

  it('a snapshot read under other selectors is not compared: everything is a first sighting', () => {
    const diff = diffSnapshots(snapshot([event('a')], { version: '0.9.0' }), snapshot([]));
    expect(passRows(diff)).toEqual([]);
    const seen = diffSnapshots(snapshot([], { version: '0.9.0' }), snapshot([event('b')]));
    expect(seen.changes).toEqual([]);
    expect(seen.sightings).toHaveLength(1);
  });

  it('snapshots of two ranges are never diffed (GcalError range_mismatch)', () => {
    const other = snapshot([], { days: ['2026-10-11', '2026-10-12'] });
    expect(() => diffSnapshots(other, snapshot([]))).toThrow(new GcalError('range_mismatch'));
  });

  it('rows carry only allowlisted fields, ordered by start, then key, then type', () => {
    const { endAt: _end, ...early } = event('z', {
      occurredAt: '2026-10-05T09:00:00-04:00',
      days: ['2026-10-05'],
    });
    expect(_end).toBeDefined();
    const diff = diffSnapshots(snapshot([event('gone')]), snapshot([event('a'), early]));
    expect(passRows(diff).map((row) => row.type)).toEqual([
      'calendar.created',
      'calendar.created',
      'calendar.deleted',
    ]);
    for (const row of passRows(diff))
      expect(
        Object.keys(row.fields).every((k) => ['occurredAt', 'subjectHint', 'counterparty'].includes(k)),
      ).toBe(true);
  });

  it('is pure: the same snapshots give the same rows, and the inputs are not changed', () => {
    const previous = snapshot([event('a'), event('b')]);
    const next = snapshot([event('b', { subjectHint: 'New' }), event('c')]);
    const copy = JSON.stringify([previous, next]);
    expect(diffSnapshots(previous, next)).toEqual(diffSnapshots(previous, next));
    expect(JSON.stringify([previous, next])).toBe(copy);
  });
});

describe('CalendarSnapshot (the stored shape)', () => {
  it.each([
    ['an event on a hidden calendar', () => snapshot([event('a', { calendar: FAMILY })])],
    ['an event outside the range', () => snapshot([event('a', { days: ['2026-10-11'] })])],
    ['two events with one key', () => snapshot([event('a'), event('a')])],
    ['an end before the start', () => snapshot([event('a', { endAt: '2026-10-06T09:00:00-04:00' })])],
    ['a subject hint over 80 code points', () => snapshot([event('a', { subjectHint: 'x'.repeat(81) })])],
    ['a two-line subject hint', () => snapshot([event('a', { subjectHint: 'a\nb' })])],
    ['an unknown field', () => snapshot([{ ...event('a'), location: 'x' } as EventInput])],
    [
      'a calendar marked ambiguous: false (only `true` or absent)',
      () =>
        CalendarSnapshot.parse({
          ...snapshot([]),
          calendars: [{ key: MAIN, shown: true, ambiguous: false }],
        }),
    ],
  ])('refuses %s', (_, build) => {
    expect(build).toThrow();
  });
});
