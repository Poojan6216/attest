/**
 * A change another range saw first is stored as a first sighting (src/background/calendar-seen.ts; docs/grading.md §3
 * orphans, §7; Decisions [2.7] wave D; Hard Rule 7). Snapshots are kept per range and rows carry no range, so an
 * event edited on a day both a week view and a two-week view show reaches each chain on its own. When the week's view
 * already held the new state (read after the two-week base, before its pass), the two-week chain's row is not when the
 * change was first seen: it gets a first-look marker and never accuses an agent. A view read at or before the base,
 * a deletion, and a state the other view never held leave the change as it is.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sameState } from '../../../src/background/calendar-seen';
import { coveredObservations, visibleAt } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { instantMs } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { IsoTs } from '../../../src/core/schema';
import { coverageFor } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { Observation } from '../../../src/ledger/types';
import {
  CalendarSnapshot,
  type CalendarSnapshotInput,
  SnapshotEvent,
} from '../../../src/observers/gcal/snapshot';
import { pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, type EventInput, FAMILY, MAIN } from './calendar-fixtures';
import { eventOn, markerOf, markers, runPass, WIDE_WINDOWS_POLICY } from './calendar-pass-harness';
import { contextOf, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-seen'));
  // The worker's clock reads after every pass instant below. Hour-long attribution windows: the cross-range rule is
  // tested alone (a change noticed late is a first sighting too: ./calendar-step.spec.ts).
  ctx = contextOf(db, { now: () => '2026-10-04T00:00:00-04:00', policy: WIDE_WINDOWS_POLICY });
});

afterEach(() => {
  db.close();
  releaseClock();
});

type Events = CalendarSnapshotInput['events'];

function days(first: string, count: number): string[] {
  const start = Date.parse(`${first}T12:00:00Z`);
  return Array.from({ length: count + 1 }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  );
}

/** A whole pass of the `count` days from Sun 4 Oct (7: the week, 14: two weeks), every calendar shown. */
function view(count: number, readAt: IsoTs, events: Events, account: string = ACCOUNT, sender = 9) {
  const shown = days('2026-10-04', count);
  const snapshot = CalendarSnapshot.parse({
    format: 1,
    observer: 'gcal.event',
    version: '1.2.0',
    range: `${shown[0]}/${shown[count - 1]}`,
    readAt,
    baselineAt: readAt,
    days: shown.slice(0, count).map((date) => ({ date, complete: true })),
    calendars: [
      { key: MAIN, shown: true },
      { key: FAMILY, shown: true },
    ],
    events,
  });
  const ping = {
    observerId: 'gcal.event',
    source: 'gcal.event' as const,
    accountHash: account,
    lastSyncAt: readAt,
    windowStart: `${shown[0]}T00:00:00-04:00`,
    windowEnd: `${shown[count]}T00:00:00-04:00`,
    allCalendars: true,
    userActive: false,
  };
  return runPass(ctx, snapshot, { account, sender, pings: [ping] });
}
const twoWeeks = (readAt: IsoTs, events: Events) => view(14, readAt, events);
const week = (readAt: IsoTs, events: Events, account?: string) => view(7, readAt, events, account, 7);

/** The orphan candidates of a batch at `evaluatedAt`, as `type:subject`. */
async function orphans(evaluatedAt: IsoTs): Promise<string[]> {
  const window = {
    fromMs: Date.parse('2026-10-01T00:00:00-04:00'),
    toMs: Date.parse('2026-10-20T00:00:00-04:00'),
  };
  const coverage = await coverageFor(db, { type: 'calendar.created', window, evaluatedAt }, DEFAULT_POLICY);
  const rows = readRows('observations', Observation, await db.observations.toArray());
  const found = await coveredObservations(
    visibleAt(createMemoryIndex(rows, 15), instantMs(evaluatedAt)),
    coverage,
    DEFAULT_POLICY,
  );
  return found.map(({ observation }) => `${observation.type}:${observation.subjectHint ?? ''}`).sort();
}

const before = eventOn('e', '2026-10-06', 10, { subjectHint: 'Standup' });
const moved = eventOn('e', '2026-10-07', 10, { subjectHint: 'Standup moved' });
/** A creation both views see only after their first looks: a change Attest saw happen. */
const fresh = eventOn('n', '2026-10-09', 14, { subjectHint: 'Created later' });
const allCalendars = { accountHash: ACCOUNT, allCalendars: true };

describe('a change another range held first', () => {
  it('the week view found the moved event before the two-week chain reported the move: no orphan, a marker', async () => {
    expect(await twoWeeks(at(0), [before])).toEqual({ ok: true });
    expect(await twoWeeks(at(5), [before])).toEqual({ ok: true });
    // Moved at about at(7). The week's first look, at(10), finds it moved already.
    expect(await week(at(10), [moved])).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [moved, fresh])).toEqual({ ok: true });
    expect(await week(at(25), [moved, fresh])).toEqual({ ok: true });
    // The two-week chain's update is stored as a first sighting at(20), with its marker; the creation it saw stays.
    expect(await markers(db)).toContainEqual(markerOf(moved, at(20), allCalendars));
    expect(await orphans(at(30))).toEqual(['calendar.created:Created later']);
  });

  it('another account’s view of the same event in the same state counts too', async () => {
    expect(await twoWeeks(at(0), [before])).toEqual({ ok: true });
    expect(await week(at(10), [moved], sha(66))).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [moved])).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual([]);
  });

  it('another account’s view of the same range counts too (only this range’s own record is left out)', async () => {
    expect(await twoWeeks(at(0), [before])).toEqual({ ok: true });
    expect(await view(14, at(10), [moved], sha(66), 7)).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [moved])).toEqual({ ok: true });
    expect(await markers(db)).toContainEqual(markerOf(moved, at(20), allCalendars));
  });

  it('an event moved into the week, after the two-week view saw the move: one report, the earlier one', async () => {
    const away = eventOn('l', '2026-10-13', 12, { subjectHint: 'Lunch' });
    const here = eventOn('l', '2026-10-08', 12, { subjectHint: 'Lunch' });
    expect(await week(at(0), [])).toEqual({ ok: true });
    expect(await twoWeeks(at(5), [away])).toEqual({ ok: true });
    // Moved to Thursday: the two-week chain reports the update at(10); the week sees a new event at(20).
    expect(await twoWeeks(at(10), [here])).toEqual({ ok: true });
    expect(await week(at(20), [here])).toEqual({ ok: true });
    expect(await markers(db)).toContainEqual(markerOf(here, at(20), allCalendars));
    expect(await orphans(at(30))).toEqual(['calendar.updated:Lunch']);
  });
});

describe('what stays a change', () => {
  it('a view read at or before the base says nothing of the change since: the update is an orphan', async () => {
    expect(await week(at(0), [moved])).toEqual({ ok: true });
    // The event is moved back, the two-week view's base sees it there, then it is moved again.
    expect(await twoWeeks(at(10), [before])).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [moved])).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual(['calendar.updated:Standup moved']);
  });

  it('a view read at the base instant itself is not after the base: the update is an orphan', async () => {
    expect(await week(at(10), [moved], sha(66))).toEqual({ ok: true });
    expect(await twoWeeks(at(10), [before])).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [moved])).toEqual({ ok: true });
    expect(await markers(db)).not.toContainEqual(markerOf(moved, at(20), allCalendars));
    expect(await orphans(at(30))).toEqual(['calendar.updated:Standup moved']);
  });

  it('a state the other view never held: the update is an orphan', async () => {
    expect(await twoWeeks(at(0), [before])).toEqual({ ok: true });
    expect(await week(at(10), [before])).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [moved])).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual(['calendar.updated:Standup moved']);
  });

  it('a view read at the very instant of the pass cannot be ordered with it: the update stays a change', async () => {
    expect(await twoWeeks(at(0), [before])).toEqual({ ok: true });
    expect(await week(at(20), [moved], sha(66))).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [moved])).toEqual({ ok: true });
    // No marker of this account at the update's first sighting (the other account's first look blocks it: rule (b)).
    expect(await markers(db)).not.toContainEqual(markerOf(moved, at(20), allCalendars));
    expect(await markers(db)).toContainEqual(
      markerOf(moved, at(20), { accountHash: sha(66), allCalendars: true }),
    );
  });

  it('a confirmed deletion is never turned into a first sighting', async () => {
    expect(await twoWeeks(at(0), [before])).toEqual({ ok: true });
    expect(await twoWeeks(at(10), [])).toEqual({ ok: true });
    expect(await week(at(15), [])).toEqual({ ok: true });
    expect(await twoWeeks(at(20), [])).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual(['calendar.deleted:Standup']);
  });
});

describe('sameState', () => {
  it('compares every field the diff compares, instants as instants and guests ASCII-folded', () => {
    const base = SnapshotEvent.parse(before);
    const withGuest = SnapshotEvent.parse({ ...before, guests: ['A@example.com'], guestCount: 1 });
    expect(sameState(base, SnapshotEvent.parse({ ...before, occurredAt: '2026-10-06T14:00:00Z' }))).toBe(
      true,
    );
    expect(
      sameState(withGuest, SnapshotEvent.parse({ ...before, guests: ['a@example.com'], guestCount: 1 })),
    ).toBe(true);
    const changes: Partial<EventInput>[] = [
      { key: sha(1) },
      { occurredAt: '2026-10-06T11:00:00-04:00' },
      { endAt: '2026-10-06T12:00:00-04:00' },
      { allDay: true },
      { subjectHint: 'Other' },
      { calendar: FAMILY },
      { guestCount: 3 },
    ];
    for (const change of changes)
      expect(sameState(base, SnapshotEvent.parse({ ...before, ...change }))).toBe(false);
    expect(
      sameState(withGuest, SnapshotEvent.parse({ ...before, guests: ['c@example.com'], guestCount: 1 })),
    ).toBe(false);
  });
});
