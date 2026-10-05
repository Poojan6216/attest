/**
 * The retention purge trusts the wall clock only as far as the ledger's own instants (src/ledger/retention-clock.ts;
 * SEC-5; Hard Rules 2, 4, 5): a clock a year ahead deletes nothing current, daily use purges exactly as
 * src/ledger/retention.ts does, and a ledger left idle still catches up.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { MS_PER_DAY } from '../../../src/core/units';
import { recordBatchInstant } from '../../../src/ledger/batch-instant';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getObservation, upsertObservation } from '../../../src/ledger/repo';
import { purgeAtTrustedClock, PURGE_TRUSTED_AT } from '../../../src/ledger/retention-clock';
import { captureLogs, makeObservation, pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('retention-clock'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const T = Date.parse('2026-10-01T10:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const days = (n: number): number => n * MS_PER_DAY;

/** A Gmail Sent row that happened and was sighted `ageDays` before T (sighting 5 minutes after it happened). */
function rowAged(n: number, ageDays: number) {
  return makeObservation({
    rowKeyHash: sha(n),
    occurredAt: iso(T - days(ageDays)),
    observedAt: iso(T - days(ageDays) + 5 * 60_000),
  });
}

const CURRENT = rowAged(1, 0);
const RECENT = rowAged(2, 30);
const OLD = rowAged(3, 120);

async function seed(): Promise<void> {
  for (const row of [OLD, RECENT, CURRENT]) await upsertObservation(db, row, DEFAULT_POLICY);
}

async function kept(): Promise<string[]> {
  const ids: string[] = [];
  for (const [name, row] of [
    ['current', CURRENT],
    ['recent', RECENT],
    ['old', OLD],
  ] as const) {
    if ((await getObservation(db, row.id)) !== undefined) ids.push(name);
  }
  return ids;
}

describe('a clock far ahead of what the ledger stored', () => {
  it('a clock a year ahead deletes nothing current, only what was already older than the retention', async () => {
    await seed();
    const { records, restore } = captureLogs();
    const report = await purgeAtTrustedClock(db, { now: iso(T + days(365)) });
    restore();
    expect(await kept()).toEqual(['current', 'recent']);
    expect(report.observations).toBe(1);
    // Trusted up to the latest stored instant (the current row's sighting), not the clock.
    expect(Date.parse(report.cutoff)).toBe(T + 5 * 60_000 - days(90));
    expect(records.map((record) => record.event)).toEqual(['ledger.purge_clock_ahead']);
  });

  it('a grading batch run by the clock a year ahead does not vouch for it', async () => {
    await seed();
    await recordBatchInstant(db, iso(T + days(365)));
    const report = await purgeAtTrustedClock(db, { now: iso(T + days(365) + 60_000) });
    expect(await kept()).toEqual(['current', 'recent']);
    expect(Date.parse(report.cutoff)).toBe(T + 5 * 60_000 - days(90));
  });

  it('daily purges under a clock stuck a year ahead move at most PURGE_CATCH_UP_DAYS each', async () => {
    await seed();
    await purgeAtTrustedClock(db, { now: iso(T + 60_000) });
    for (let run = 1; run <= 3; run += 1) {
      await purgeAtTrustedClock(db, { now: iso(T + days(365 + run)) });
    }
    // Trusted moved from T to T + 6 days: the recent row (30 days old) and the current one stay.
    expect(await kept()).toEqual(['current', 'recent']);
    const trusted = await db.meta.get(PURGE_TRUSTED_AT);
    expect(Date.parse(String(trusted?.value))).toBe(T + 60_000 + days(6));
  });
});

describe('daily use and an idle ledger', () => {
  it('with something stored within the catch-up, the purge is retention.ts at the wall clock', async () => {
    await seed();
    const { records, restore } = captureLogs();
    const report = await purgeAtTrustedClock(db, { now: iso(T + days(1)) });
    restore();
    expect(Date.parse(report.cutoff)).toBe(T + 5 * 60_000 - days(90));
    expect(await kept()).toEqual(['current', 'recent']);
    expect(records).toEqual([]);
  });

  it('a ledger nobody stored into since catches up, one day faster than real time per daily purge', async () => {
    await upsertObservation(db, RECENT, DEFAULT_POLICY);
    await purgeAtTrustedClock(db, { now: iso(T) });
    // The browser is used again 70 days later with no Gmail or Calendar tab: the recent row reaches 90 days of age
    // in real time after 60 more days, and the purge catches up instead of keeping it for good.
    let now = T + days(70);
    while ((await getObservation(db, RECENT.id)) !== undefined && now < T + days(400)) {
      await purgeAtTrustedClock(db, { now: iso(now) });
      now += days(1);
    }
    expect(await getObservation(db, RECENT.id)).toBeUndefined();
    expect(now).toBeLessThan(T + days(200));
  });

  it('a ledger that never stored an instant purges at the wall clock', async () => {
    const report = await purgeAtTrustedClock(db, { now: iso(T) });
    expect(Date.parse(report.cutoff)).toBe(T - days(90));
  });

  it('a malformed now is refused before anything is read', async () => {
    await expect(purgeAtTrustedClock(db, { now: '2026-10-01 10:00' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
