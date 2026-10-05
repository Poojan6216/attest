/**
 * The clock guard (src/ledger/clock-guard.ts; Decisions [2.7] wave E; Hard Rules 4, 5, 6, 7): the high water every
 * stored sighting, sync and read raises; the repair a clock below it triggers (what it deletes, what it keeps, the
 * floor it raises); and a row first seen after the writer's clock, whose earlier re-sightings are no news.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { putCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import {
  CLOCK_FLOOR_AT,
  CLOCK_HIGH_WATER,
  guardClock,
  noteStoredInstant,
} from '../../../src/ledger/clock-guard';
import { readInterval, recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  getObservation,
  putCoveragePing,
  recordBatchInstant,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import { IsoTs, type ObserverCoverageInput } from '../../../src/ledger/types';
import { CalendarSnapshot } from '../../../src/observers/gcal/snapshot';
import {
  captureLogs,
  expectLedgerError,
  makeClaim,
  makeObservation,
  makePing,
  pinClock,
  releaseClock,
  sha,
  uniqueDbName,
} from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('clock-guard'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** 10:00 New York time on Sat 3 Oct 2026 plus `minutes`. */
const at = (minutes: number): IsoTs =>
  IsoTs.parse(
    `${new Date(Date.parse('2026-10-03T14:00:00Z') + minutes * 60_000 - 4 * 3_600_000).toISOString().slice(0, 23)}-04:00`,
  );
const ms = (iso: string): number => Date.parse(iso);
const meta = async (key: string) => (await db.meta.get(key))?.value;

const gcalRow = (sighted: IsoTs, n = 1) =>
  makeObservation({
    source: 'gcal.event',
    type: 'calendar.created',
    observedAt: sighted,
    rowKeyHash: sha(n),
  });
const sentRow = (sighted: IsoTs, n = 1) => makeObservation({ observedAt: sighted, rowKeyHash: sha(n) });

function interval(lastSyncAt: IsoTs, overrides: Partial<ObserverCoverageInput> = {}): ObserverCoverageInput {
  return {
    observerId: 'gcal.event',
    source: 'gcal.event',
    accountHash: sha(9),
    lastSyncAt,
    windowStart: '2026-10-04T00:00:00-04:00',
    windowEnd: '2026-10-11T00:00:00-04:00',
    allCalendars: true,
    ...overrides,
  };
}

function snapshotAt(readAt: IsoTs, range = '2026-10-04/2026-10-04') {
  const [day] = range.split('/');
  return {
    observerId: 'gcal.event',
    accountHash: sha(9),
    range,
    snapshot: CalendarSnapshot.parse({
      format: 1,
      observer: 'gcal.event',
      version: '1.2.0',
      range,
      readAt,
      baselineAt: readAt,
      days: [{ date: day, complete: true }],
      calendars: [{ key: sha(3), shown: true }],
      events: [],
    }),
    pending: [],
  };
}

const intervalSyncs = async () =>
  (await db.coverageIntervals.toArray())
    .map((row) => readInterval(row)?.entry.lastSyncAt)
    .filter((each) => each !== undefined)
    .sort((a, b) => ms(a) - ms(b));

describe('the high water', () => {
  it('rises with every stored sighting, sync and read, compared as instants, never falls', async () => {
    await noteStoredInstant(db, at(10));
    await noteStoredInstant(db, IsoTs.parse('2026-10-03T13:59:00Z')); // 09:59 New York: earlier
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(10));
    await upsertObservation(db, sentRow(at(20)), DEFAULT_POLICY);
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(20));
    await upsertClaim(db, makeClaim({ observedAt: at(30) }));
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(30));
    await recordCoverage(db, interval(at(40)));
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(40));
    await putCalendarRecord(db, snapshotAt(at(50)));
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(50));
    // A batch instant is not evidence: it does not raise it.
    await recordBatchInstant(db, at(60));
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(50));
  });

  it('a re-sighting changes nothing stored, so it raises nothing', async () => {
    await upsertObservation(db, sentRow(at(20)), DEFAULT_POLICY);
    await upsertObservation(db, sentRow(at(25)), DEFAULT_POLICY);
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(20));
  });
});

describe('a clock at or after the high water', () => {
  it('changes nothing and has no floor, at the high water itself too (no tolerance either way)', async () => {
    await recordCoverage(db, interval(at(40)));
    const { records, restore } = captureLogs();
    expect(await guardClock(db, ms(at(40)))).toBeUndefined();
    expect(await guardClock(db, ms(at(90)))).toBeUndefined();
    restore();
    expect(records).toEqual([]);
    expect(await intervalSyncs()).toEqual([at(40)]);
    expect(await meta(CLOCK_HIGH_WATER)).toBe(at(40));
  });
});

/**
 * Before the clock went back: a window and a marker at 10:20; then, ahead, a Gmail window, a marker and a ping at
 * 15:00, and a record of each age. Calendar rows first seen ahead: one no batch read (15:02), one a batch read (15:00);
 * a Gmail row seen ahead (15:03); and a Calendar row first seen at 10:10, stored after the batch.
 */
async function storeBeforeAndAhead(): Promise<void> {
  await recordCoverage(db, interval(at(20)));
  await recordCoverage(
    db,
    interval(at(20), { windowStart: at(-60), windowEnd: at(-60), changesSince: at(20) }),
  );
  await recordCoverage(db, {
    observerId: 'gmail.sent',
    source: 'gmail.sent',
    accountHash: sha(9),
    lastSyncAt: at(300),
    windowStart: at(-60),
    windowEnd: at(300),
  });
  await recordCoverage(
    db,
    interval(at(300), { windowStart: at(-30), windowEnd: at(-30), changesSince: at(300) }),
  );
  await putCoveragePing(db, makePing({ observerId: 'gmail.sent', lastSyncAt: at(300) }));
  await putCoveragePing(db, makePing({ observerId: 'gcal.event', source: 'gcal.event', lastSyncAt: at(20) }));
  await putCalendarRecord(db, snapshotAt(at(20)));
  await putCalendarRecord(db, snapshotAt(at(300), '2026-10-05/2026-10-05'));
  await upsertObservation(db, gcalRow(at(300), 1), DEFAULT_POLICY);
  await recordBatchInstant(db, at(301));
  await upsertObservation(db, gcalRow(at(302), 2), DEFAULT_POLICY);
  await upsertObservation(db, sentRow(at(303), 3), DEFAULT_POLICY);
  await upsertObservation(db, gcalRow(at(10), 4), DEFAULT_POLICY);
}

describe('a clock below the high water (it went back): the repair', () => {
  it('deletes what was stored after it, keeps the rest, raises the floor and clears the high water', async () => {
    await storeBeforeAndAhead();
    const { records, restore } = captureLogs();
    expect(await guardClock(db, ms(at(100)))).toBe(at(303));
    restore();
    expect(records.map((each) => [each.event, each.fields])).toEqual([
      ['ledger.clock_regressed', { intervals: 2, pings: 1, records: 1, rows: 1 }],
    ]);
    expect(await intervalSyncs()).toEqual([at(20), at(20)]);
    expect((await db.coverage.toArray()).map((row) => row.observerId)).toEqual(['gcal.event']);
    expect((await db.calendarSnapshots.toArray()).map((row) => row.range)).toEqual(['2026-10-04/2026-10-04']);
    // The unread Calendar row first seen ahead is gone; the row a batch read stays (replay), as do every Gmail row
    // and the Calendar row first seen before the clock went back.
    const kept = (await db.observations.toArray()).map((row) => row.rowKeyHash).sort();
    expect(kept).toEqual([sha(1), sha(3), sha(4)].sort());
    expect(await meta(CLOCK_FLOOR_AT)).toBe(at(303));
    expect(await meta(CLOCK_HIGH_WATER)).toBeUndefined();
    // Done once: the same clock again finds nothing to repair, and keeps the floor.
    const again = captureLogs();
    expect(await guardClock(db, ms(at(100)))).toBe(at(303));
    again.restore();
    expect(again.records).toEqual([]);
  });

  it('a later regression raises the floor, never lowers it', async () => {
    await recordCoverage(db, interval(at(300)));
    expect(await guardClock(db, ms(at(100)))).toBe(at(300));
    await recordCoverage(db, interval(at(200)));
    // The clock goes back again, below what was stored since: repaired, and the floor stays at the higher instant.
    expect(await guardClock(db, ms(at(150)))).toBe(at(300));
    expect(await intervalSyncs()).toEqual([]);
  });

  it('a Calendar record stored before the high water existed still reads as ahead of the clock', async () => {
    await putCalendarRecord(db, snapshotAt(at(300)));
    await db.meta.delete(CLOCK_HIGH_WATER);
    expect(await guardClock(db, ms(at(100)))).toBe(at(300));
    expect(await db.calendarSnapshots.count()).toBe(0);
  });
});

describe('a row first seen after the writer clock', () => {
  it('an earlier re-sighting is no news: nothing changes, nothing is refused', async () => {
    await upsertObservation(db, gcalRow(at(300)), DEFAULT_POLICY);
    const result = await upsertObservation(db, gcalRow(at(100)), DEFAULT_POLICY, { clockMs: ms(at(120)) });
    expect(result.inserted).toBe(false);
    const stored = await getObservation(db, result.id);
    expect(stored?.observedAt).toBe(at(300));
  });

  it('one first seen at or before the clock still refuses an earlier sighting (late_sighting)', async () => {
    await upsertObservation(db, gcalRow(at(300)), DEFAULT_POLICY);
    await expectLedgerError(
      upsertObservation(db, gcalRow(at(100)), DEFAULT_POLICY, { clockMs: ms(at(300)) }),
      'late_sighting',
    );
    await expectLedgerError(upsertObservation(db, gcalRow(at(100)), DEFAULT_POLICY), 'late_sighting');
  });
});
