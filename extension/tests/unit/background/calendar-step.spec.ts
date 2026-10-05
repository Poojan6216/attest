/**
 * The Calendar pass step (src/background/calendar-step.ts; sprint_2 2.7; Decisions [2.7]; Hard Rules 5, 7): what the
 * service worker reports when a pass's snapshot meets the stored record of its range.
 */
import { describe, expect, it } from 'vitest';

import { type CalendarRow, calendarStep, staleChangeMs } from '../../../src/background/calendar-step';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { IsoTs } from '../../../src/core/schema';
import { at, event, FAMILY, keyOf, record, week } from './calendar-fixtures';

/** A bound no gap of these tests reaches: every change here is noticed in time (see 'a change noticed late'). */
const WIDE = { staleAfterMs: 60 * 60_000 };

const types = (rows: readonly CalendarRow[]) => rows.map(({ row }) => [row.type, row.rowKey]);
const eventKeys = (step: ReturnType<typeof calendarStep>) =>
  step.snapshot.events.map((each) => each.key).sort();

describe('a first look at a range', () => {
  it('reports every event as a first sighting at the pass instant, and starts following changes there', () => {
    const next = week(
      [event('a'), event('b', { guests: ['zed@example.com', 'amy@example.org'], guestCount: 2 })],
      {
        readAt: at(0),
      },
    );
    const step = calendarStep(null, next, WIDE);
    expect(types(step.rows)).toEqual([
      ['calendar.created', keyOf('a')],
      ['calendar.created', keyOf('b')],
    ]);
    expect(step.rows.every((row) => row.sightedAt === at(0))).toBe(true);
    expect(step.coverage).toEqual({ kind: 'followed', changesSince: at(0) });
    expect(step.pending).toEqual([]);
    expect(step.snapshot.baselineAt).toBe(at(0));
  });

  it('a first look that could not see every day covers what was there, not what changed', () => {
    const step = calendarStep(null, week([event('a')], { hidden: ['2026-10-08'] }), WIDE);
    expect(types(step.rows)).toEqual([['calendar.created', keyOf('a')]]);
    expect(step.coverage).toEqual({ kind: 'plain' });
  });

  it('a base read under other selectors is no base: the pass is a first look', () => {
    const stored = record(week([event('a')], { version: '1.1.0', readAt: at(0) }));
    const step = calendarStep(stored, week([event('a')], { readAt: at(10) }), WIDE);
    expect(types(step.rows)).toEqual([['calendar.created', keyOf('a')]]);
    expect(step.coverage).toEqual({ kind: 'followed', changesSince: at(10) });
  });
});

describe('changes against the stored base', () => {
  const base = record(week([event('a')], { readAt: at(0) }));

  it('a new event is a calendar.created first seen at this pass; changes stay followed since the first look', () => {
    const step = calendarStep(base, week([event('a'), event('b')], { readAt: at(10) }), WIDE);
    expect(types(step.rows)).toEqual([['calendar.created', keyOf('b')]]);
    expect(step.rows[0]?.sightedAt).toBe(at(10));
    expect(step.coverage).toEqual({ kind: 'followed', changesSince: at(0) });
    expect(step.snapshot.baselineAt).toBe(at(0));
  });

  it('an unchanged week reports nothing', () => {
    const step = calendarStep(base, week([event('a')], { readAt: at(10) }), WIDE);
    expect(step.rows).toEqual([]);
    expect(step.coverage).toEqual({ kind: 'followed', changesSince: at(0) });
  });

  it('an edit is one calendar.updated of the new state, never a calendar.created of it (Hard Rule 7)', () => {
    const moved = event('a', { occurredAt: '2026-10-06T15:00:00-04:00', endAt: '2026-10-06T16:00:00-04:00' });
    const step = calendarStep(base, week([moved], { readAt: at(10) }), WIDE);
    expect(types(step.rows)).toEqual([['calendar.updated', keyOf('a')]]);
    expect(step.rows[0]?.row.fields).toMatchObject({ occurredAt: '2026-10-06T15:00:00-04:00' });
  });
});

describe('a deletion is reported only after two consecutive complete snapshots lack the event', () => {
  const base = record(week([event('a'), event('b')], { readAt: at(0) }));
  const first = calendarStep(base, week([event('a')], { readAt: at(10) }), WIDE);

  it('the first absence reports nothing, keeps the event in the base, and records no coverage', () => {
    expect(first.rows).toEqual([]);
    expect(first.pending).toEqual([{ key: keyOf('b'), since: at(10), baseAt: at(0) }]);
    expect(eventKeys(first)).toEqual([keyOf('a'), keyOf('b')].sort());
    expect(first.coverage).toEqual({ kind: 'none' });
  });

  it('the second confirms it: one calendar.deleted, first seen at the first absence', () => {
    const second = calendarStep(
      record(first.snapshot, first.pending),
      week([event('a')], { readAt: at(20) }),
      WIDE,
    );
    expect(types(second.rows)).toEqual([['calendar.deleted', keyOf('b')]]);
    expect(second.rows[0]?.sightedAt).toBe(at(10));
    expect(second.pending).toEqual([]);
    expect(eventKeys(second)).toEqual([keyOf('a')]);
    expect(second.coverage).toEqual({ kind: 'followed', changesSince: at(0) });
  });

  it('the event coming back clears the absence and reports nothing', () => {
    const back = calendarStep(
      record(first.snapshot, first.pending),
      week([event('a'), event('b')], { readAt: at(20) }),
      WIDE,
    );
    expect(back.rows).toEqual([]);
    expect(back.pending).toEqual([]);
    expect(back.coverage).toEqual({ kind: 'followed', changesSince: at(0) });
  });
});

describe('a snapshot that cannot vouch for an absence', () => {
  const base = record(week([event('a'), event('b')], { readAt: at(0) }));
  const first = calendarStep(base, week([event('a')], { readAt: at(10) }), WIDE);

  it('a snapshot with a hidden day vouches for no absence: the event is carried, the chain breaks', () => {
    const hidden = calendarStep(base, week([event('a')], { readAt: at(10), hidden: ['2026-10-06'] }), WIDE);
    expect(hidden.rows).toEqual([]);
    expect(hidden.pending).toEqual([]);
    expect(eventKeys(hidden)).toEqual([keyOf('a'), keyOf('b')].sort());
    expect(hidden.coverage).toEqual({ kind: 'plain' });
    expect(hidden.snapshot.baselineAt).toBe(at(10));
    // The next complete snapshot sees the first absence; one more confirms it.
    const next = calendarStep(
      record(hidden.snapshot, hidden.pending),
      week([event('a')], { readAt: at(20) }),
      WIDE,
    );
    expect(next.rows).toEqual([]);
    expect(next.pending).toEqual([{ key: keyOf('b'), since: at(20), baseAt: at(10) }]);
    const confirmed = calendarStep(
      record(next.snapshot, next.pending),
      week([event('a')], { readAt: at(30) }),
      WIDE,
    );
    expect(types(confirmed.rows)).toEqual([['calendar.deleted', keyOf('b')]]);
    expect(confirmed.coverage).toEqual({ kind: 'followed', changesSince: at(20) });
  });

  it('a calendar named twice vouches for no absence either', () => {
    const step = calendarStep(base, week([event('a')], { readAt: at(10), mainNamedTwice: true }), WIDE);
    expect(step.rows).toEqual([]);
    expect(step.pending).toEqual([]);
    expect(eventKeys(step)).toEqual([keyOf('a'), keyOf('b')].sort());
    expect(step.coverage).toEqual({ kind: 'plain' });
  });

  it('a pending absence survives a snapshot that cannot vouch, and the next complete one confirms it', () => {
    const hidden = calendarStep(
      record(first.snapshot, first.pending),
      week([event('a')], { readAt: at(20), hidden: ['2026-10-06'] }),
      WIDE,
    );
    expect(hidden.pending).toEqual([{ key: keyOf('b'), since: at(10), baseAt: at(0) }]);
    const confirmed = calendarStep(
      record(hidden.snapshot, hidden.pending),
      week([event('a')], { readAt: at(30) }),
      WIDE,
    );
    expect(types(confirmed.rows)).toEqual([['calendar.deleted', keyOf('b')]]);
    expect(confirmed.rows[0]?.sightedAt).toBe(at(10));
  });
});

describe('a calendar named twice', () => {
  it('voids every absence of its snapshot, even on a calendar the list names once', () => {
    const family = event('f', { calendar: FAMILY });
    const both = record(week([event('a'), family], { readAt: at(0), familyShown: true }));
    const twice = calendarStep(
      both,
      week([event('a')], { readAt: at(10), familyShown: true, mainNamedTwice: true }),
      WIDE,
    );
    expect(twice.rows).toEqual([]);
    expect(twice.pending).toEqual([]);
    expect(eventKeys(twice)).toEqual([keyOf('a'), keyOf('f')].sort());
    // The count starts at the next complete snapshot: its absence is the first, not the second.
    const next = calendarStep(
      record(twice.snapshot, twice.pending),
      week([event('a')], { readAt: at(20), familyShown: true }),
      WIDE,
    );
    expect(next.rows).toEqual([]);
    expect(next.pending).toEqual([{ key: keyOf('f'), since: at(20), baseAt: at(10) }]);
  });
});

describe('a base too large to carry what it waits on', () => {
  it('keeps the pass alone, forgets the absences it cannot confirm, and follows changes only from now', () => {
    const many = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, i) => event(`e${String(from + i)}`));
    const full = record(week(many(0, 500), { readAt: at(0) }));
    // Two events gone and two new ones: carrying the two absent would hold 502 events, more than one snapshot holds.
    const step = calendarStep(full, week([...many(0, 498), ...many(900, 902)], { readAt: at(10) }), WIDE);
    const created = [keyOf('e900'), keyOf('e901')].sort();
    expect(types(step.rows)).toEqual(created.map((key) => ['calendar.created', key]));
    expect(step.pending).toEqual([]);
    expect(step.snapshot.events).toHaveLength(500);
    expect(step.snapshot.baselineAt).toBe(at(10));
    // The forgotten absences happened before this pass: no window may claim it followed them.
    expect(step.coverage).toEqual({ kind: 'followed', changesSince: at(10) });
  });
});

describe('a calendar switched on', () => {
  it('its events are first sightings, and the chain restarts at the pass (they were there before)', () => {
    const base = record(week([event('a')], { readAt: at(0) }));
    const family = event('f', { calendar: FAMILY });
    const step = calendarStep(base, week([event('a'), family], { readAt: at(10), familyShown: true }), WIDE);
    expect(types(step.rows)).toEqual([['calendar.created', keyOf('f')]]);
    expect(step.coverage).toEqual({ kind: 'followed', changesSince: at(10) });
    expect(step.snapshot.baselineAt).toBe(at(10));
  });

  it('switched off again, its events are neither deleted nor carried', () => {
    const family = event('f', { calendar: FAMILY });
    const base = record(week([event('a'), family], { readAt: at(0), familyShown: true }));
    const step = calendarStep(base, week([event('a')], { readAt: at(10) }), WIDE);
    expect(step.rows).toEqual([]);
    expect(step.pending).toEqual([]);
    expect(eventKeys(step)).toEqual([keyOf('a')]);
  });
});

describe('which rows are first sightings (stored with a first-look marker, src/ledger/first-look.ts)', () => {
  const flags = (rows: readonly CalendarRow[]) =>
    rows.map(({ row, firstSighting }) => [row.type, firstSighting]);

  it('every row of a first look; no change, no confirmed deletion; every event of a calendar switched on', () => {
    expect(flags(calendarStep(null, week([event('a')], { readAt: at(0) }), WIDE).rows)).toEqual([
      ['calendar.created', true],
    ]);
    const base = record(week([event('a'), event('b')], { readAt: at(0) }), [
      { key: keyOf('b'), since: at(5), baseAt: at(0) },
    ]);
    const switched = week([event('a', { subjectHint: 'Moved' }), event('f', { calendar: FAMILY })], {
      readAt: at(10),
      familyShown: true,
    });
    expect(flags(calendarStep(base, switched, WIDE).rows)).toEqual([
      ['calendar.updated', false],
      ['calendar.deleted', false],
      ['calendar.created', true],
    ]);
  });
});

// A change noticed late is a first sighting (Decisions [2.7] wave E; Hard Rule 7).
const bound = { staleAfterMs: staleChangeMs(DEFAULT_POLICY) };
/** Noon on Sat 3 Oct 2026 plus `ms` milliseconds, New York time (at() to the millisecond). */
const atMs = (ms: number): IsoTs =>
  IsoTs.parse(`${new Date(Date.parse(at(0)) + ms - 4 * 3_600_000).toISOString().slice(0, 23)}-04:00`);
const sightingFlags = (rows: readonly CalendarRow[]) =>
  rows.map(({ row, firstSighting }) => [row.type, firstSighting]);
const lastLook = record(week([event('a'), event('b')], { readAt: at(0) }));
const edited = (readAt: IsoTs) =>
  week([event('a', { subjectHint: 'Renamed' }), event('b'), event('c')], { readAt });

describe('a creation or an update noticed late is a first sighting (wave E; Hard Rule 7)', () => {
  it('the bound is the narrowest attribution window: two minutes under the shipped policy', () => {
    expect(bound.staleAfterMs).toBe(2 * 60_000);
    const windows = { sessionMin: 30, idleMin: 7, adjacentMin: 5 };
    expect(staleChangeMs({ unasked: { ...DEFAULT_POLICY.unasked, windows } })).toBe(5 * 60_000);
  });

  it('a creation or an update compared with a base read within the bound accuses; one more ms, it does not', () => {
    const inTime = calendarStep(lastLook, edited(atMs(2 * 60_000)), bound);
    expect(sightingFlags(inTime.rows)).toEqual([
      ['calendar.created', false],
      ['calendar.updated', false],
    ]);
    const late = calendarStep(lastLook, edited(atMs(2 * 60_000 + 1)), bound);
    expect(sightingFlags(late.rows)).toEqual([
      ['calendar.created', true],
      ['calendar.updated', true],
    ]);
    // Rows only: the windows still follow changes since the first look, and the record keeps the chain.
    expect(late.coverage).toEqual({ kind: 'followed', changesSince: at(0) });
    expect(late.snapshot.baselineAt).toBe(at(0));
    expect(late.rows.every((row) => row.sightedAt === atMs(2 * 60_000 + 1))).toBe(true);
  });
});

describe('a deletion noticed late is a first sighting (wave E; Hard Rule 7)', () => {
  it('a deletion is judged by the base its first absence was compared with, not by the confirming pass', () => {
    const lateFirst = calendarStep(lastLook, week([event('a')], { readAt: at(10) }), bound);
    expect(lateFirst.pending).toEqual([{ key: keyOf('b'), since: at(10), baseAt: at(0) }]);
    const confirmed = calendarStep(
      record(lateFirst.snapshot, lateFirst.pending),
      week([event('a')], { readAt: at(11) }),
      bound,
    );
    expect(sightingFlags(confirmed.rows)).toEqual([['calendar.deleted', true]]);
    expect(confirmed.rows[0]?.sightedAt).toBe(at(10));
    // Compared with a fresh base, the same deletion accuses, however long its confirmation took.
    const fresh = record(week([event('a'), event('b')], { readAt: at(9) }));
    const firstAbsence = calendarStep(fresh, week([event('a')], { readAt: at(10) }), bound);
    const later = calendarStep(
      record(firstAbsence.snapshot, firstAbsence.pending),
      week([event('a')], { readAt: at(240) }),
      bound,
    );
    expect(sightingFlags(later.rows)).toEqual([['calendar.deleted', false]]);
  });

  it('an absence a record kept without its base (stored before wave E) is read as noticed late', () => {
    const legacy = record(week([event('a'), event('b')], { readAt: at(9) }), [
      { key: keyOf('b'), since: at(10) },
    ]);
    const confirmed = calendarStep(legacy, week([event('a')], { readAt: at(11) }), bound);
    expect(sightingFlags(confirmed.rows)).toEqual([['calendar.deleted', true]]);
  });

  it('a pending absence carried through a snapshot that cannot vouch keeps its base', () => {
    const first = calendarStep(
      record(week([event('a'), event('b')], { readAt: at(9) })),
      week([event('a')], { readAt: at(10) }),
      bound,
    );
    const hidden = calendarStep(
      record(first.snapshot, first.pending),
      week([event('a')], { readAt: at(11), hidden: ['2026-10-06'] }),
      bound,
    );
    expect(hidden.pending).toEqual([{ key: keyOf('b'), since: at(10), baseAt: at(9) }]);
    const confirmed = calendarStep(
      record(hidden.snapshot, hidden.pending),
      week([event('a')], { readAt: at(30) }),
      bound,
    );
    expect(sightingFlags(confirmed.rows)).toEqual([['calendar.deleted', false]]);
  });
});
