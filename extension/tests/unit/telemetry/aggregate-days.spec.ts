import 'fake-indexeddb/auto';
/**
 * The usage numbers of a day whose length is not 24 hours (Sprint 5 close, tech review TECH-2, QA GAP 1;
 * src/telemetry/aggregate.ts). When the clocks go back, a day lasts 25 hours, and a reader whose windows covered all of
 * it would report 25, which the schema refuses: the day would never be built, nor sent. It reports 24, the most a day
 * holds. When the clocks go forward, a day lasts 23 hours, and a whole day covered reports 23. The days are built by
 * hand, so the test reads alike in any time zone. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isoWithLocalOffset } from '../../../src/clock';
import { MS_PER_HOUR } from '../../../src/core/units';
import { recordCoverage } from '../../../src/ledger/coverage-store';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { buildTelemetry, type TelemetryDay } from '../../../src/telemetry/aggregate';
import { sha, uniqueDbName } from '../ledger/fixtures';

const FACTS = { installId: '4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b', extVersion: '0.1.0', chromeMajor: 154 };
const FROM = new Date(2026, 10, 1).getTime();

let db: LedgerDb;
beforeEach(async () => {
  db = await openLedger(uniqueDbName('telemetry-days'));
});
afterEach(() => {
  db.close();
});

/** A day of `hours` hours from FROM, whose Gmail Sent windows cover all of it and an hour on each side. */
async function coveredDay(hours: number): Promise<TelemetryDay> {
  const day = { bucket: '2026-11-01', fromMs: FROM, toMs: FROM + hours * MS_PER_HOUR };
  const at = (ms: number): string => isoWithLocalOffset(new Date(ms));
  await recordCoverage(db, {
    observerId: 'gmail.sent',
    source: 'gmail.sent',
    accountHash: sha(1),
    windowStart: at(day.fromMs - MS_PER_HOUR),
    windowEnd: at(day.toMs + MS_PER_HOUR),
    lastSyncAt: at(day.toMs + MS_PER_HOUR),
  });
  return day;
}

describe('a day that is not 24 hours long', () => {
  it('builds the day the clocks go back, 25 hours fully covered, as 24 hours', async () => {
    const payload = await buildTelemetry(db, FACTS, await coveredDay(25));
    expect(payload).not.toBeNull();
    expect(payload?.coverageHours).toEqual({ gmail: 24, gcal: 0 });
  });

  it('builds the day the clocks go forward, 23 hours fully covered, as 23 hours', async () => {
    const payload = await buildTelemetry(db, FACTS, await coveredDay(23));
    expect(payload?.coverageHours).toEqual({ gmail: 23, gcal: 0 });
  });
});
