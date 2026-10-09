/**
 * `coverageForBatch` (src/ledger/coverage-batch.ts, the grading batch's reader): a batch's coverage for all of its
 * claims in one read transaction, reading the Calendar source once per instant instead of once per claim (the wave D
 * verifier's residual cost). For random Calendar windows and markers, Gmail windows, two accounts, and random claims
 * of every observed type at two batch instants, the coverage at each instant holds exactly the entries `coverageFor`
 * gives each of its queries alone (Hard Rule 4: the same coverage, so the same `coverageHash` and receipts), and the
 * reads it saves are counted. It took over from `coverageForMany`, which no batch called (tech review TECH-6).
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ActionType } from '../../../src/core/schema';
import { type CoverageQuery, coverageFor, recordCoverage } from '../../../src/ledger/coverage';
import { coverageForBatch } from '../../../src/ledger/coverage-batch';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { isoAt, MS_PER_MINUTE } from '../../tools/attest-world';
import { expectLedgerError, sha, uniqueDbName } from '../../unit/ledger/fixtures';

const RUNS = 60;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const GRID_MS = Date.parse('2026-10-04T00:00:00-04:00');
const NOON_MS = Date.parse('2026-10-03T12:00:00-04:00');
const hour = (h: number) => isoAt(GRID_MS + h * MS_PER_HOUR, -240);
const clock = (minutes: number) => isoAt(NOON_MS + minutes * MS_PER_MINUTE, -240);

const calendarArb = fc.record({
  startHour: fc.nat({ max: 300 }),
  lengthHours: fc.constantFrom(0, 0, 24, 48, 168),
  syncMinutes: fc.nat({ max: 300 }),
  account: fc.constantFrom(0, 1),
  followed: fc.boolean(),
});

const sentArb = fc.record({
  startHour: fc.nat({ max: 300 }),
  syncHours: fc.nat({ max: 40 }),
  account: fc.constantFrom(0, 1),
});

const queryArb = fc.record({
  type: fc.constantFrom<ActionType>('calendar.created', 'calendar.deleted', 'email.sent', 'purchase.made'),
  fromHour: fc.nat({ max: 320 }),
  lengthHours: fc.nat({ max: 72 }),
  late: fc.boolean(),
  noWindow: fc.boolean(),
});

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

async function store(db: LedgerDb, calendar: Generated<typeof calendarArb>): Promise<void> {
  const lastSyncAt = clock(calendar.syncMinutes);
  const point = calendar.lengthHours === 0;
  await recordCoverage(db, {
    observerId: 'gcal.event',
    source: 'gcal.event',
    lastSyncAt,
    windowStart: hour(calendar.startHour),
    windowEnd: hour(calendar.startHour + calendar.lengthHours),
    accountHash: sha(900 + calendar.account),
    allCalendars: true,
    ...(point || calendar.followed ? { changesSince: point ? lastSyncAt : clock(0) } : {}),
  });
}

async function storeSent(db: LedgerDb, sent: Generated<typeof sentArb>): Promise<void> {
  const end = hour(sent.startHour + sent.syncHours);
  await recordCoverage(db, {
    observerId: 'gmail.sent',
    source: 'gmail.sent',
    lastSyncAt: end,
    windowStart: hour(sent.startHour),
    windowEnd: end,
    accountHash: sha(800 + sent.account),
  });
}

function queryOf(query: Generated<typeof queryArb>): CoverageQuery {
  const window = {
    fromMs: GRID_MS + query.fromHour * MS_PER_HOUR,
    toMs: GRID_MS + (query.fromHour + query.lengthHours) * MS_PER_HOUR,
  };
  return {
    type: query.type,
    window: query.noWindow ? null : window,
    evaluatedAt: query.late ? hour(400) : clock(150),
  };
}

let db: LedgerDb;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('coverage-many'));
});

afterEach(() => {
  db.close();
});

/** Each entry once, as one string, sorted: a coverage's entries compared as a set. */
const entrySet = (entries: readonly object[]): string[] =>
  [...new Set(entries.map((e) => JSON.stringify(e)))].sort();

describe('coverageForBatch is coverageFor, query by query', () => {
  it('holds, at each instant, exactly the entries coverageFor gives each of its queries alone', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(calendarArb, { maxLength: 14 }),
        fc.array(sentArb, { maxLength: 4 }),
        fc.array(queryArb, { minLength: 1, maxLength: 8 }),
        async (calendars, sents, queries) => {
          await db.coverageIntervals.clear();
          for (const calendar of calendars) await store(db, calendar);
          for (const sent of sents) await storeSent(db, sent);
          const asked = queries.map(queryOf);
          for (const at of new Set(asked.map((query) => query.evaluatedAt))) {
            const group = asked.filter((query) => query.evaluatedAt === at);
            const alone = [];
            for (const query of group)
              alone.push(...(await coverageFor(db, query, DEFAULT_POLICY)).observers);
            const batch = await coverageForBatch(db, at, group, DEFAULT_POLICY);
            expect(batch.evaluatedAt).toBe(at);
            expect(entrySet(batch.observers)).toEqual(entrySet(alone));
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('coverageForBatch reads less', () => {
  it('reads the Calendar source and each source’s latest per account once per instant, not once per claim', async () => {
    for (let week = 0; week < 6; week += 1) {
      await store(db, {
        startHour: week * 168,
        lengthHours: 168,
        syncMinutes: week,
        account: 0,
        followed: true,
      });
      await store(db, {
        startHour: week * 168 + 9,
        lengthHours: 0,
        syncMinutes: week,
        account: 1,
        followed: true,
      });
    }
    const claims = Array.from({ length: 8 }, (_, i) =>
      queryOf({ type: 'calendar.created', fromHour: i * 30, lengthHours: 2, late: false, noWindow: false }),
    );
    const where = vi.spyOn(db.coverageIntervals, 'where');
    const at = claims[0]?.evaluatedAt ?? clock(150);
    const one = await coverageForBatch(db, at, claims.slice(0, 1), DEFAULT_POLICY);
    const single = where.mock.calls.length;
    where.mockClear();
    const many = await coverageForBatch(db, at, claims, DEFAULT_POLICY);
    // Each further claim reads only its own window's entries: two queries each, its points and the spans that may
    // reach it (TECH-1); the Calendar closure, the accounts and their latest are read once for the batch.
    expect(where.mock.calls.length).toBe(single + 2 * (claims.length - 1));
    where.mockRestore();
    expect(entrySet(many.observers)).toEqual(expect.arrayContaining(entrySet(one.observers)));
  });

  it('checks every query before it reads anything', async () => {
    const good = queryOf({ type: 'email.sent', fromHour: 0, lengthHours: 1, late: false, noWindow: false });
    const where = vi.spyOn(db.coverageIntervals, 'where');
    await expectLedgerError(
      coverageForBatch(
        db,
        good.evaluatedAt,
        [good, { ...good, window: { fromMs: 5, toMs: 1 } }],
        DEFAULT_POLICY,
      ),
      'invalid_input',
    );
    expect(where).not.toHaveBeenCalled();
    where.mockRestore();
  });
});
