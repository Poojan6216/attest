import 'fake-indexeddb/auto';
/**
 * src/ledger/coverage-batch.ts (sprint_3 3.13): the one coverage a grading batch grades with, the union of what
 * `coverageFor` returns for each of its queries, each entry once, in `coverageFor`'s own order; every query at the
 * batch's instant.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ObserverCoverageInput } from '../../../src/core/schema';
import { coverageFor, recordCoverage } from '../../../src/ledger/coverage';
import { coverageForBatch } from '../../../src/ledger/coverage-batch';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { expectLedgerError, pinClock, releaseClock, sha, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock('2026-10-02T00:00:00Z');
  db = await openLedger(uniqueDbName('coverage-batch'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const ms = (iso: string) => Date.parse(iso);
const EVALUATED_AT = '2026-10-01T23:00:00Z';

const sent = (from: string, to: string): ObserverCoverageInput => ({
  observerId: 'gmail',
  source: 'gmail.sent',
  lastSyncAt: to,
  windowStart: from,
  windowEnd: to,
  accountHash: sha(900),
});

const week: ObserverCoverageInput = {
  observerId: 'gcal.event',
  source: 'gcal.event',
  lastSyncAt: '2026-10-01T12:00:00Z',
  windowStart: '2026-09-28T04:00:00Z',
  windowEnd: '2026-10-05T04:00:00Z',
  accountHash: sha(901),
  allCalendars: true,
};

const morning = { fromMs: ms('2026-10-01T08:00:00Z'), toMs: ms('2026-10-01T09:30:00Z') };
const evening = { fromMs: ms('2026-10-01T17:00:00Z'), toMs: ms('2026-10-01T18:30:00Z') };

describe('coverageForBatch', () => {
  it('is the union of every query’s coverage, each entry once, in coverageFor’s order', async () => {
    await recordCoverage(db, sent('2026-10-01T08:30:00Z', '2026-10-01T09:00:00Z'));
    await recordCoverage(db, sent('2026-10-01T17:30:00Z', '2026-10-01T18:00:00Z'));
    await recordCoverage(db, week);
    const queries = [
      { type: 'email.sent' as const, window: morning, evaluatedAt: EVALUATED_AT },
      { type: 'email.sent' as const, window: evening, evaluatedAt: EVALUATED_AT },
      { type: 'email.sent' as const, window: morning, evaluatedAt: EVALUATED_AT },
      { type: 'calendar.created' as const, window: morning, evaluatedAt: EVALUATED_AT },
    ];
    const batch = await coverageForBatch(db, EVALUATED_AT, queries, DEFAULT_POLICY);
    const each = await Promise.all(queries.map((query) => coverageFor(db, query, DEFAULT_POLICY)));
    const union = new Map(each.flatMap((c) => c.observers).map((entry) => [JSON.stringify(entry), entry]));
    expect(batch.evaluatedAt).toBe(EVALUATED_AT);
    expect(batch.observers).toHaveLength(union.size);
    expect(new Set(batch.observers.map((entry) => JSON.stringify(entry)))).toEqual(new Set(union.keys()));
    expect(batch.observers.map((entry) => entry.source)).toEqual(['gcal.event', 'gmail.sent', 'gmail.sent']);
  });

  it('refuses a query at another instant before reading anything', async () => {
    await expectLedgerError(
      coverageForBatch(
        db,
        EVALUATED_AT,
        [{ type: 'email.sent', window: morning, evaluatedAt: '2026-10-01T22:00:00Z' }],
        DEFAULT_POLICY,
      ),
      'invalid_input',
    );
  });
});
