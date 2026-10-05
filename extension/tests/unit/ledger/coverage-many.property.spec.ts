/**
 * `coverageForMany` (src/ledger/coverage.ts): a batch's coverage for all of its claims in one read transaction,
 * reading the Calendar source once per instant instead of once per claim (the wave D verifier's residual cost).
 * For random Calendar windows and markers, Gmail windows, two accounts, and random claims of every observed type at
 * two batch instants, each result is exactly what `coverageFor` returns for its query alone (Hard Rule 4: the same
 * coverage, so the same `coverageHash` and receipts), and the reads it saves are counted.
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ActionType } from '../../../src/core/schema';
import {
  type CoverageQuery,
  coverageFor,
  coverageForMany,
  recordCoverage,
} from '../../../src/ledger/coverage';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { isoAt, MS_PER_MINUTE } from '../../tools/attest-world';
import { expectLedgerError, sha, uniqueDbName } from './fixtures';

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

describe('coverageForMany is coverageFor, query by query', () => {
  it('gives each query exactly what coverageFor gives it alone', async () => {
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
          const alone = [];
          for (const query of asked) alone.push(await coverageFor(db, query, DEFAULT_POLICY));
          expect(await coverageForMany(db, asked, DEFAULT_POLICY)).toEqual(alone);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('coverageForMany reads less', () => {
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
    const one = await coverageForMany(db, claims.slice(0, 1), DEFAULT_POLICY);
    const single = where.mock.calls.length;
    where.mockClear();
    const many = await coverageForMany(db, claims, DEFAULT_POLICY);
    // Each further claim reads only its own window's entries: one query each.
    expect(where.mock.calls.length).toBe(single + claims.length - 1);
    where.mockRestore();
    expect(many[0]).toEqual(one[0]);
  });

  it('checks every query before it reads anything', async () => {
    const good = queryOf({ type: 'email.sent', fromHour: 0, lengthHours: 1, late: false, noWindow: false });
    const where = vi.spyOn(db.coverageIntervals, 'where');
    await expectLedgerError(
      coverageForMany(db, [good, { ...good, window: { fromMs: 5, toMs: 1 } }], DEFAULT_POLICY),
      'invalid_input',
    );
    expect(where).not.toHaveBeenCalled();
    where.mockRestore();
  });
});
