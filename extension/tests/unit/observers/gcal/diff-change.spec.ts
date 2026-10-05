/**
 * What the Calendar diff counts as a change, field by field, and the order of its rows (sprint_2 2.5; Hard Rules 4,
 * 5): each compared field alone makes an update, an update that swaps or adds a guest names the guest it added, and
 * rows come out by start instant whatever their keys. Then the stored snapshot's own checks, one at a time
 * (src/observers/gcal/snapshot.ts): a snapshot that fails one is refused at the boundary.
 */
import { describe, expect, it } from 'vitest';

import { type CalendarDiff, diffSnapshots } from '../../../../src/observers/gcal/diff';
import { CalendarSnapshot } from '../../../../src/observers/gcal/snapshot';
import { event, FAMILY, snapshot, snapshotInput } from './snapshot-builders';

/** Every row a diff reports: the changes, then the first sightings. */
const passRows = (diff: CalendarDiff) => [...diff.changes, ...diff.sightings];

const ALEX = 'alex.rivera@example.com';
const PRIYA = 'priya.raman@example.org';

function changesOf(was: ReturnType<typeof event>, now: ReturnType<typeof event>, familyShown = false) {
  return diffSnapshots(snapshot([was], { familyShown }), snapshot([now], { familyShown })).changes;
}

describe('diff: each compared field alone is an update', () => {
  it('the all-day flag alone (same start, no end)', () => {
    const { endAt: _end, ...timed } = event('a');
    expect(_end).toBeDefined();
    const changes = changesOf(timed, { ...timed, allDay: true });
    expect(changes.map((row) => row.type)).toEqual(['calendar.updated']);
  });

  it('the calendar alone (both shown in both snapshots)', () => {
    const changes = changesOf(event('a'), event('a', { calendar: FAMILY }), true);
    expect(changes.map((row) => row.type)).toEqual(['calendar.updated']);
  });

  it('the guest count alone (a list cut at its cap)', () => {
    const was = event('a', { guests: [ALEX], guestCount: 1 });
    const changes = changesOf(was, { ...was, guestCount: 2 });
    expect(changes.map((row) => row.type)).toEqual(['calendar.updated']);
  });

  it('one guest swapped for another (same count): an update naming the new guest', () => {
    const was = event('a', { guests: [ALEX], guestCount: 1 });
    const changes = changesOf(was, { ...was, guests: [PRIYA] });
    expect(changes.map((row) => [row.type, row.fields])).toEqual([
      ['calendar.updated', expect.objectContaining({ counterparty: PRIYA })],
    ]);
  });

  it('a guest added after the first: the update names the added guest, not the first one', () => {
    const was = event('a', { guests: [ALEX], guestCount: 1 });
    const changes = changesOf(was, { ...was, guests: [ALEX, PRIYA], guestCount: 2 });
    expect(changes.map((row) => row.fields)).toEqual([expect.objectContaining({ counterparty: PRIYA })]);
  });

  it('an update that only removed guests names the first remaining guest', () => {
    const was = event('a', { guests: [ALEX, PRIYA], guestCount: 2 });
    const changes = changesOf(was, { ...was, guests: [PRIYA], guestCount: 1 });
    expect(changes.map((row) => row.fields)).toEqual([expect.objectContaining({ counterparty: PRIYA })]);
  });
});

describe('diff: row order', () => {
  it('rows come out by start instant even when the event keys sort the other way', () => {
    const early = event('g', { occurredAt: '2026-10-05T09:00:00-04:00', endAt: '2026-10-05T10:00:00-04:00' });
    const late = event('f', { occurredAt: '2026-10-08T09:00:00-04:00', endAt: '2026-10-08T10:00:00-04:00' });
    const middle = event('a');
    const keys = [early.key, middle.key, late.key];
    expect([...keys].sort()).toEqual([...keys].reverse());
    const rows = passRows(diffSnapshots(snapshot([]), snapshot([late, early, middle])));
    expect(rows.map((row) => (row.fields as { occurredAt: string }).occurredAt)).toEqual([
      '2026-10-05T09:00:00-04:00',
      '2026-10-06T10:00:00-04:00',
      '2026-10-08T09:00:00-04:00',
    ]);
  });
});

describe('CalendarSnapshot refuses a snapshot that fails one of its own checks', () => {
  const base = snapshotInput([]);
  const days = base.days;

  it.each([
    ['a baseline after its read', { ...base, baselineAt: '2026-10-03T12:00:01-04:00' }],
    ['a range that is not its first and last day', { ...base, range: '2026-10-04/2026-10-09' }],
    [
      'days out of order (range still first/last)',
      { ...base, days: [days[0], days[2], days[1], ...days.slice(3)] },
    ],
    ['a day listed twice', { ...base, days: [days[0], ...days] }],
    [
      'a guest count below the guests it lists',
      snapshotInput([event('a', { guests: [ALEX, PRIYA], guestCount: 1 })]),
    ],
  ])('%s', (_, input) => {
    expect(CalendarSnapshot.safeParse(input).success).toBe(false);
  });

  it('accepts the same snapshot unchanged (the cases above differ from it in one field)', () => {
    expect(CalendarSnapshot.safeParse(base).success).toBe(true);
  });
});
