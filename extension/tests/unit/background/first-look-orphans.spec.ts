/**
 * An event already on the calendar never accuses an agent (docs/grading.md §3 orphans, §7; Decisions [2.7] wave D;
 * Hard Rule 7). The wave C verifier's probes, kept: account B (or a page with no account) first looks at days account
 * A's view follows, and stores first sightings A's entry would read as changes it saw happen. Each scenario stores
 * what the service worker stores, reads the batch's coverage (`coverageFor`, closed under overlap) and asks the
 * batch's own orphan discovery (core `coveredObservations`, through `isOrphanCandidate`): the event already there is
 * never an orphan candidate, while a real change A's view saw later still is (A looks again a minute before it, so
 * the change is not one noticed late, ../background/calendar-step.ts `staleChangeMs`).
 *  (i) a multi-day event that began before B's visible range (outside every window of B's pass);
 *  (ii) an event on a day B's pass hid behind "N more" (outside every window of B's pass);
 *  (iii) a first look refused `late_sighting` (stored all or none: nothing of it stays);
 *  (iv) a calendar switched on while an absence waits for confirmation (the pass records no window);
 *  (v) a page with no account (its rows posted by the content script).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coveredObservations, visibleAt } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { instantMs } from '../../../src/core/normalize';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { IsoTs } from '../../../src/core/schema';
import { coverageFor } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { type CoveragePingInput, Observation } from '../../../src/ledger/types';
import { CalendarSnapshot, type CalendarSnapshotInput } from '../../../src/observers/gcal/snapshot';
import { pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, event, FAMILY, MAIN, week } from './calendar-fixtures';
import { eventOn, postedElsewhere, runPass } from './calendar-pass-harness';
import { contextOf, type TestContext } from './observer-harness';

// Since v1.12 no Calendar change is known to be the account's own (src/background/calendar-own.ts), so none
// accuses. These scenarios keep the rules a change must also meet once it can be (the live smoke, sprint_2 2.8):
// they run as if the account made every change.
vi.mock('../../../src/background/calendar-own', () => ({ accountMadeChange: () => true }));

let db: LedgerDb;
let ctx: TestContext;
const B = sha(66);

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('first-look-orphans'));
  ctx = contextOf(db);
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** Account A's pass from tab 9 (`A` below), B's from tab 7. */
const A = (snapshot: CalendarSnapshot) => runPass(ctx, snapshot, { sender: 9 });
const byB = (snapshot: CalendarSnapshot, pings?: readonly CoveragePingInput[]) =>
  runPass(ctx, snapshot, { account: B, ...(pings === undefined ? {} : { pings }) });

/** The subject hints of every orphan candidate of a batch at `evaluatedAt` over Sep 27 to Oct 11. */
async function orphans(evaluatedAt: IsoTs): Promise<string[]> {
  const window = {
    fromMs: Date.parse('2026-09-27T00:00:00-04:00'),
    toMs: Date.parse('2026-10-11T00:00:00-04:00'),
  };
  const coverage = await coverageFor(db, { type: 'calendar.created', window, evaluatedAt }, DEFAULT_POLICY);
  const rows = readRows('observations', Observation, await db.observations.toArray());
  const index = visibleAt(createMemoryIndex(rows, 15), instantMs(evaluatedAt));
  const found = await coveredObservations(index, coverage, DEFAULT_POLICY);
  return found.map(({ observation }) => observation.subjectHint ?? '').sort();
}

const PREV_DAYS = [
  '2026-09-27',
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
];

/** Account A's previous week, Sep 27 to Oct 3, read at `readAt`. */
function prevWeek(readAt: IsoTs, events: CalendarSnapshotInput['events'] = []): CalendarSnapshot {
  return CalendarSnapshot.parse({
    format: 1,
    observer: 'gcal.event',
    version: '1.2.0',
    range: '2026-09-27/2026-10-03',
    readAt,
    baselineAt: readAt,
    days: PREV_DAYS.map((date) => ({ date, complete: true })),
    calendars: [{ key: MAIN, shown: true }],
    events,
  });
}

const prevPing = (readAt: IsoTs) => ({
  observerId: 'gcal.event',
  source: 'gcal.event' as const,
  accountHash: ACCOUNT,
  lastSyncAt: readAt,
  windowStart: '2026-09-27T00:00:00-04:00',
  windowEnd: '2026-10-04T00:00:00-04:00',
  allCalendars: true,
  userActive: false,
});

/** A change A's view of the week sees at `readAt` (an event created since its first look). */
const created = eventOn('n', '2026-10-09', 14, { subjectHint: 'Created later' });

describe('an event already on the calendar is never an orphan candidate; a change A saw later still is', () => {
  it('(i) a multi-day event that began before B’s visible range', async () => {
    expect(await runPass(ctx, prevWeek(at(0)), { sender: 9, pings: [prevPing(at(0))] })).toEqual({
      ok: true,
    });
    const conference = event('m', {
      subjectHint: 'Conference',
      occurredAt: '2026-10-02T09:00:00-04:00',
      endAt: '2026-10-05T17:00:00-04:00',
      days: ['2026-10-04', '2026-10-05'],
    });
    expect(await byB(week([conference], { readAt: at(10) }))).toEqual({ ok: true });
    const change = eventOn('p', '2026-10-01', 9, { subjectHint: 'Created later' });
    // A looks again just before the change (a change compared with a stale base would be a first sighting).
    expect(await runPass(ctx, prevWeek(at(19)), { sender: 9, pings: [prevPing(at(19))] })).toEqual({
      ok: true,
    });
    expect(await runPass(ctx, prevWeek(at(20), [change]), { sender: 9, pings: [prevPing(at(20))] })).toEqual({
      ok: true,
    });
    expect(await orphans(at(30))).toEqual(['Created later']);
  });

  it('(ii) an event on a day B’s pass hid behind "N more"', async () => {
    expect(await A(week([], { readAt: at(0) }))).toEqual({ ok: true });
    const busy = eventOn('h', '2026-10-08', 10, { subjectHint: 'Busy day' });
    const runs = [
      { windowStart: '2026-10-04T00:00:00-04:00', windowEnd: '2026-10-08T00:00:00-04:00' },
      { windowStart: '2026-10-09T00:00:00-04:00', windowEnd: '2026-10-11T00:00:00-04:00' },
    ].map((run) => ({ ...prevPing(at(10)), ...run, accountHash: B, allCalendars: false }));
    expect(await byB(week([busy], { readAt: at(10), hidden: ['2026-10-08'] }), runs)).toEqual({ ok: true });
    expect(await A(week([], { readAt: at(19) }))).toEqual({ ok: true });
    expect(await A(week([created], { readAt: at(20) }))).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual(['Created later']);
  });
});

describe('the first sightings of a pass that recorded no window over them never accuse an agent', () => {
  it('(iii) a first look refused late_sighting leaves nothing; B’s next first look marks what it finds', async () => {
    expect(await A(week([], { readAt: at(0) }))).toEqual({ ok: true });
    const z = event('z');
    await postedElsewhere(ctx, z, at(15));
    const y = eventOn('y', '2026-10-07', 9, { subjectHint: 'Already there' });
    expect(await byB(week([z, y], { readAt: at(10) }))).toEqual({ ok: false, code: 'late_sighting' });
    expect(await A(week([], { readAt: at(19) }))).toEqual({ ok: true });
    expect(await A(week([created], { readAt: at(20) }))).toEqual({ ok: true });
    expect(await byB(week([z, y], { readAt: at(25) }))).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual(['Created later']);
  });

  it('(iv) a calendar switched on while an absence waits for confirmation', async () => {
    expect(await A(week([], { readAt: at(0) }))).toEqual({ ok: true });
    expect(await byB(week([event('a'), eventOn('b', '2026-10-07')], { readAt: at(2) }))).toEqual({
      ok: true,
    });
    const family = eventOn('f', '2026-10-08', 18, { calendar: FAMILY, subjectHint: 'Family dinner' });
    // b gone (a first absence) and Family switched on in one pass; then the user closes the tab.
    const switched = week([event('a'), family], { readAt: at(10), familyShown: true });
    expect(
      await byB(switched, [
        {
          ...prevPing(at(10)),
          windowStart: '2026-10-04T00:00:00-04:00',
          windowEnd: '2026-10-11T00:00:00-04:00',
          accountHash: B,
        },
      ]),
    ).toEqual({ ok: true });
    expect(await A(week([], { readAt: at(19) }))).toEqual({ ok: true });
    expect(await A(week([created], { readAt: at(20) }))).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual(['Created later']);
  });

  it('(v) a page with no account', async () => {
    expect(await A(week([], { readAt: at(0) }))).toEqual({ ok: true });
    await postedElsewhere(ctx, eventOn('w', '2026-10-07', 9, { subjectHint: 'Weekly sync' }), at(10));
    expect(await A(week([], { readAt: at(19) }))).toEqual({ ok: true });
    expect(await A(week([created], { readAt: at(20) }))).toEqual({ ok: true });
    expect(await orphans(at(30))).toEqual(['Created later']);
  });
});
