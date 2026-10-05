/**
 * Coverage intervals carry `changesSince` (sprint_2 2.7 interface 2; src/ledger/coverage.ts): it is part of an
 * interval's group, so a Calendar range's run of compared snapshots is never united with a neighbouring range first
 * seen later, which would claim its changes were followed before anyone looked (Hard Rules 5, 7).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ObserverCoverageInput } from '../../../src/core/schema';
import { coverageFor, recordCoverage } from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('coverage-changes'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

/** A Calendar pass of one week (`startDay` of October 2026 + 7 days), synced at `sync`, following since `since`. */
function week(startDay: number, sync: string, since?: string): ObserverCoverageInput {
  const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T00:00:00-04:00`;
  return {
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt: sync,
    windowStart: day(startDay),
    windowEnd: day(startDay + 7),
    accountHash: sha(900),
    allCalendars: true,
    ...(since === undefined ? {} : { changesSince: since }),
  };
}

const read = async () =>
  (
    await coverageFor(
      db,
      { type: 'calendar.deleted', window: null, evaluatedAt: '2026-10-31T00:00:00Z' },
      DEFAULT_POLICY,
    )
  ).observers;

describe('changesSince is part of the coverage group', () => {
  it('passes of one run of compared snapshots unite: one interval, the latest sync, the same changesSince', async () => {
    await recordCoverage(db, week(4, '2026-10-03T12:00:00-04:00', '2026-10-03T12:00:00-04:00'));
    await recordCoverage(db, week(4, '2026-10-03T12:30:00-04:00', '2026-10-03T12:00:00-04:00'));
    expect(await db.coverageIntervals.count()).toBe(1);
    expect(await read()).toEqual([week(4, '2026-10-03T12:30:00-04:00', '2026-10-03T12:00:00-04:00')]);
  });

  it('a neighbouring week first seen later is never united with it, though the windows touch', async () => {
    await recordCoverage(db, week(4, '2026-10-03T12:00:00-04:00', '2026-10-03T12:00:00-04:00'));
    await recordCoverage(db, week(11, '2026-10-03T13:00:00-04:00', '2026-10-03T13:00:00-04:00'));
    expect(await db.coverageIntervals.count()).toBe(2);
  });

  it('a window without changesSince never unites with one that has it', async () => {
    await recordCoverage(db, week(4, '2026-10-03T12:00:00-04:00'));
    await recordCoverage(db, week(4, '2026-10-03T12:30:00-04:00', '2026-10-03T12:00:00-04:00'));
    expect(await db.coverageIntervals.count()).toBe(2);
    const window = {
      fromMs: Date.parse('2026-10-05T00:00:00-04:00'),
      toMs: Date.parse('2026-10-06T00:00:00-04:00'),
    };
    const both = await coverageFor(
      db,
      { type: 'calendar.deleted', window, evaluatedAt: '2026-10-31T00:00:00Z' },
      DEFAULT_POLICY,
    );
    expect(both.observers.map((entry) => entry.changesSince ?? null)).toEqual([
      null,
      '2026-10-03T12:00:00-04:00',
    ]);
  });
});

describe('coverageFor holds Calendar coverage closed under overlap (docs/grading.md §3, v1.9)', () => {
  it('with an entry it returns, every other synced one overlapping it, whatever its account', async () => {
    // Account A followed Oct 4–11; account B first looked at Oct 8–15 later; the claim's window is Oct 5 only.
    await recordCoverage(db, week(4, '2026-10-03T12:00:00-04:00', '2026-10-03T12:00:00-04:00'));
    await recordCoverage(db, {
      ...week(8, '2026-10-03T13:00:00-04:00', '2026-10-03T13:00:00-04:00'),
      accountHash: sha(901),
    });
    // A third, far away and on no chain of overlaps, is not drawn in (beyond the latest of each account).
    await recordCoverage(db, { ...week(20, '2026-10-03T11:00:00-04:00'), accountHash: sha(901) });
    const window = {
      fromMs: Date.parse('2026-10-05T00:00:00-04:00'),
      toMs: Date.parse('2026-10-06T00:00:00-04:00'),
    };
    const coverage = await coverageFor(
      db,
      { type: 'calendar.created', window, evaluatedAt: '2026-10-31T00:00:00Z' },
      DEFAULT_POLICY,
    );
    expect(coverage.observers.map((entry) => [entry.windowStart, entry.accountHash])).toEqual([
      ['2026-10-04T00:00:00-04:00', sha(900)],
      ['2026-10-08T00:00:00-04:00', sha(901)],
    ]);
  });

  it('draws in entries that are no account latest, through every link of the chain', async () => {
    // A followed Oct 1–8. B's first look at Oct 6–13 and C's at Oct 11–18 are neither in the claim's window nor
    // their accounts' latest passes (Oct 20–27 and Oct 22–29): only the chain of overlaps A → B → C reaches them.
    const at = (hour: number) => `2026-10-03T${String(hour).padStart(2, '0')}:00:00-04:00`;
    await recordCoverage(db, week(1, at(12), at(12)));
    await recordCoverage(db, { ...week(6, at(13), at(13)), accountHash: sha(901) });
    await recordCoverage(db, { ...week(20, at(14), at(14)), accountHash: sha(901) });
    await recordCoverage(db, { ...week(11, at(13), at(13)), accountHash: sha(902) });
    await recordCoverage(db, { ...week(22, at(15), at(15)), accountHash: sha(902) });
    const window = {
      fromMs: Date.parse('2026-10-02T00:00:00-04:00'),
      toMs: Date.parse('2026-10-03T00:00:00-04:00'),
    };
    const coverage = await coverageFor(
      db,
      { type: 'calendar.created', window, evaluatedAt: '2026-10-31T00:00:00Z' },
      DEFAULT_POLICY,
    );
    const held = coverage.observers.map(
      (entry) => `${entry.windowStart.slice(0, 10)} ${entry.accountHash ?? ''}`,
    );
    expect(held.sort()).toEqual(
      [
        `2026-10-01 ${sha(900)}`,
        `2026-10-06 ${sha(901)}`,
        `2026-10-11 ${sha(902)}`,
        `2026-10-20 ${sha(901)}`,
        `2026-10-22 ${sha(902)}`,
      ].sort(),
    );
  });
});
