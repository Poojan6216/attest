/**
 * A Calendar pass is stored all or none (src/background/calendar-pass.ts steps 3 to 6; docs/grading.md §3 `gcal.event`
 * bullet; Decisions [2.7] wave D; Hard Rules 5, 6, 7): a refusal, or a worker stopped half way, leaves no row, no
 * marker, no record and no window of it; and a refused pass restarts the chain, so a row derived again from the same
 * record every time cannot refuse every later pass. A record stored while the clock was ahead: ./calendar-clock.spec.ts.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onObservations } from '../../../src/background/observer-messages';
import { DEFAULT_POLICY, PolicyError } from '../../../src/core/policy';
import { getCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth, upsertObservation } from '../../../src/ledger/repo';
import { captureLogs, pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, event, RANGE, week } from './calendar-fixtures';
import {
  eventOn,
  markerOf,
  markers,
  postedElsewhere,
  rowOf,
  runPass,
  windows,
} from './calendar-pass-harness';
import { contextOf, rowsOf, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('calendar-pass-atomic'));
  ctx = contextOf(db);
});

afterEach(() => {
  db.close();
  releaseClock();
});

const record = () => getCalendarRecord(db, { observerId: 'gcal.event', accountHash: ACCOUNT, range: RANGE });
const subjects = async () => (await db.observations.toArray()).map((row) => row.subjectHint).sort();

describe('all or none', () => {
  it('a refusal on the last row leaves none of the rows, markers, record or windows written before it', async () => {
    const z = eventOn('z', '2026-10-09');
    await postedElsewhere(ctx, z, at(5));
    const stored = await markers(db);
    // The pass sights a first (stored, with its marker), then z earlier than the stored sighting: refused.
    const { records, restore } = captureLogs();
    expect(await runPass(ctx, week([event('a'), z], { readAt: at(0) }))).toEqual({
      ok: false,
      code: 'late_sighting',
    });
    restore();
    // Logged with the number of rows the pass derived (both), never which ones.
    expect(records.filter((each) => each.event === 'observer.refused').map((each) => each.fields)).toEqual([
      { observer: 'gcal.event', type: 'calendar.snapshot', code: 'late_sighting', count: 2 },
    ]);
    expect(await subjects()).toEqual(['Event z']);
    expect(await markers(db)).toEqual(stored);
    expect(await windows(db)).toEqual([]);
    expect(await db.calendarSnapshots.count()).toBe(0);
    expect(await db.coverage.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gcal.event')).toMatchObject({ reasons: ['ledger.late_sighting'] });
  });

  it('a worker stopped between the rows and the record leaves nothing of the pass', async () => {
    const put = vi.spyOn(db.calendarSnapshots, 'put').mockImplementationOnce(() => {
      throw new Error('worker stopped');
    });
    await expect(
      runPass(ctx, week([event('a'), eventOn('b', '2026-10-07')], { readAt: at(0) })),
    ).rejects.toThrow('worker stopped');
    expect(put).toHaveBeenCalledTimes(1);
    expect(await db.observations.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await db.calendarSnapshots.count()).toBe(0);
    // Its rows are derived again by the next pass, which compares with nothing stored: a first look.
    expect(await runPass(ctx, week([event('a'), eventOn('b', '2026-10-07')], { readAt: at(10) }))).toEqual({
      ok: true,
    });
    expect(await markers(db)).toEqual([
      markerOf(event('a'), at(10)),
      markerOf(eventOn('b', '2026-10-07'), at(10)),
    ]);
  });
});

describe('a refused pass restarts its range chain', () => {
  it('a confirmed deletion another view stored later refuses one pass, not every later one', async () => {
    const b = eventOn('b', '2026-10-07');
    await runPass(ctx, week([event('a'), b], { readAt: at(0) }));
    await runPass(ctx, week([event('a')], { readAt: at(10) }));
    expect((await record())?.pending).toHaveLength(1);
    // Another range's chain confirmed the same deletion first, first seen at its own first absence.
    await upsertObservation(db, rowOf(b, at(15), 'calendar.deleted'), DEFAULT_POLICY);
    const { records, restore } = captureLogs();
    expect(await runPass(ctx, week([event('a')], { readAt: at(20) }))).toEqual({
      ok: false,
      code: 'late_sighting',
    });
    restore();
    expect(await record()).toBeUndefined();
    expect(records.map((each) => [each.event, each.fields])).toContainEqual([
      'observer.calendar_restarted',
      { observer: 'gcal.event', reason: 'refused' },
    ]);
    // The next pass is a first look at its own instant, and is stored.
    expect(await runPass(ctx, week([event('a')], { readAt: at(30) }))).toEqual({ ok: true });
    expect((await record())?.snapshot.baselineAt).toBe(at(30));
    expect((await windows(db)).at(-1)).toMatchObject({ changesSince: at(30), lastSyncAt: at(30) });
  });
});

describe('a policy loadPolicy did not return is a bug: it fails loud, never as DEGRADED, and stores nothing', () => {
  const nothingStored = async () => {
    expect(await db.observations.count()).toBe(0);
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await db.calendarSnapshots.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gcal.event')).toBeUndefined();
  };

  it('a pass with a known account', async () => {
    const copied = contextOf(db, { policy: { ...DEFAULT_POLICY } });
    await expect(runPass(copied, week([event('a')], { readAt: at(0) }))).rejects.toBeInstanceOf(PolicyError);
    await nothingStored();
  });

  it('the rows of a page with no account', async () => {
    const copied = contextOf(db, { policy: { ...DEFAULT_POLICY } });
    await expect(
      onObservations(copied, rowsOf('gcal.event', [rowOf(event('a'), at(0))])),
    ).rejects.toBeInstanceOf(PolicyError);
    await nothingStored();
  });
});
