/**
 * The retention purge (src/ledger/retention.ts; docs/grading.md §9; Decisions [2.6]). Done-when: a purge removes
 * exactly the old rows. One ledger holds every case the rule names; the test asserts the exact ids left in each table,
 * the exact coverage left, the report, idempotence, and that nothing the purge keeps can grade a false NOT_FOUND.
 *
 * Now 2027-01-01T12:00Z, 90 days: the cutoff is 2026-10-03T12:00Z.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { candidates } from '../../../src/core/candidates';
import { coverageLevel } from '../../../src/core/conditions';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { Claim, Grant } from '../../../src/core/schema';
import { coverageForClaim, readInterval, recordCoverage } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { createLedgerIndex } from '../../../src/ledger/index';
import { openLedger } from '../../../src/ledger/migrations';
import {
  getObservation,
  putCoveragePing,
  putReceipt,
  putRequest,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import { RETENTION_DAYS } from '../../../src/config';
import { purgeExpired } from '../../../src/ledger/retention';
import { CoveragePing } from '../../../src/ledger/types';
import {
  claimId,
  expectLedgerError,
  makeClaim,
  makeGrant,
  makeObservation,
  makePing,
  makeReceipt,
  makeRequest,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

const NOW = '2027-01-01T12:00:00Z';
const CUTOFF = '2026-10-03T12:00:00.000Z';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('retention'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const obs = (n: number, occurredAt: string, extra: Record<string, unknown> = {}) =>
  makeObservation({ rowKeyHash: sha(n), occurredAt, observedAt: occurredAt, ...extra });
const event = (n: number, occurredAt: string) =>
  obs(n, occurredAt, { source: 'gcal.event', type: 'calendar.created', observedAt: '2026-09-25T10:05:00Z' });

/** The observations, by name. `edge` is evidence of a kept claim from before the cutoff. */
const O = {
  old: obs(1, '2026-09-20T10:00:00Z'),
  fresh: obs(2, '2026-12-20T10:00:00Z'),
  edge: obs(3, '2026-10-03T11:59:30Z'),
  freeOld: obs(4, '2026-09-01T10:00:00Z'),
  freeFresh: obs(5, '2026-12-01T10:00:00Z'),
  /** Evidence after the cutoff of an old calendar claim: current, so it stays with that claim and its receipt. */
  later: event(6, '2026-10-05T10:00:00Z'),
};

const claim = (n: number, claimedAt: string, extra: Record<string, unknown> = {}) =>
  makeClaim({ rawHash: sha(100 + n), claimedAt, observedAt: claimedAt, requestId: ulid(200 + n), ...extra });
const C = {
  old: claim(1, '2026-09-20T10:00:00Z'),
  fresh: claim(2, '2026-12-20T10:00:00Z'),
  edge: claim(3, '2026-10-03T12:01:00Z'),
  /** Claimed before the cutoff, about an event after it (O.later): kept with its receipt (rule 3). */
  calendar: claim(4, '2026-09-25T10:00:00Z', { type: 'calendar.created', targetAt: '2026-10-05T10:00:00Z' }),
  /** Claimed after the cutoff, last graded before it: the claim goes with its receipt (rule 2). */
  stale: claim(8, '2026-10-04T10:00:00Z'),
};

/** A claim-less scope-diff receipt (§6.1 observedScopeExceedsDeclared): no claim, no evidence. */
const scopeReceipt = (n: number, computedAt: string) =>
  makeReceipt({
    id: ulid(n),
    claimId: undefined,
    requestId: undefined,
    grade: 'OVER_SCOPE',
    ruleId: 'over_scope_observed',
    reasons: [],
    signals: {},
    observationIds: [],
    computedAt,
  });

const receipt = (n: number, observationIds: string[], computedAt: string) =>
  makeReceipt({
    id: ulid(300 + n),
    claimId: claimId(100 + n),
    requestId: ulid(200 + n),
    observationIds,
    computedAt,
  });
const R = {
  old: receipt(1, [O.old.id], '2026-09-20T10:31:00Z'),
  fresh: receipt(2, [O.fresh.id], '2026-12-20T10:31:00Z'),
  edge: receipt(3, [O.edge.id], '2026-10-03T12:31:00Z'),
  calendar: receipt(4, [O.later.id], '2026-10-05T10:31:00Z'),
  stale: receipt(8, [], '2026-10-02T10:00:00Z'),
  /** An UNASKED receipt of the old evidence, superseded by the old claim, regraded after the cutoff. */
  superseded: makeReceipt({
    id: ulid(305),
    claimId: undefined,
    requestId: undefined,
    grade: 'UNASKED',
    attribution: 'likely',
    ruleId: 'unasked',
    reasons: [{ code: 'superseded', params: { claimId: claimId(101) } }],
    supersededBy: claimId(101),
    observationIds: [O.old.id],
    computedAt: '2026-10-04T10:00:00Z',
  }),
  scopeOld: scopeReceipt(306, '2026-09-01T10:00:00Z'),
  scopeFresh: scopeReceipt(307, '2026-12-01T10:00:00Z'),
};

const Q = {
  old: makeRequest({ id: ulid(201), ts: '2026-09-20T09:58:00Z' }),
  fresh: makeRequest({ id: ulid(202), ts: '2026-12-20T09:58:00Z' }),
  /** Older than the cutoff, but the kept edge claim names it. */
  edge: makeRequest({ id: ulid(203), ts: '2026-10-03T11:58:00Z' }),
  free: makeRequest({ id: ulid(209), ts: '2026-09-01T09:58:00Z' }),
};

const gmail = (start: string, end: string) => ({
  observerId: 'gmail',
  source: 'gmail.sent' as const,
  accountHash: sha(900),
  windowStart: start,
  windowEnd: end,
  lastSyncAt: end,
});
const gcal = (start: string, end: string) => ({
  ...gmail(start, end),
  observerId: 'gcal',
  source: 'gcal.event' as const,
  allCalendars: true,
});

async function seed(): Promise<void> {
  for (const o of Object.values(O)) await upsertObservation(db, o, DEFAULT_POLICY);
  for (const c of Object.values(C)) await upsertClaim(db, c);
  for (const r of Object.values(R)) await putReceipt(db, r);
  for (const q of Object.values(Q)) await putRequest(db, q);
  await recordCoverage(db, gmail('2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'));
  await recordCoverage(db, gmail('2026-09-30T00:00:00Z', '2026-10-10T00:00:00Z'));
  await recordCoverage(db, gmail('2026-12-01T00:00:00Z', '2026-12-31T00:00:00Z'));
  await recordCoverage(db, gcal('2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z'));
  await recordCoverage(db, {
    ...gcal('2026-10-04T00:00:00Z', '2026-10-05T10:00:00Z'),
    observerId: 'gcal.week',
  });
  await putCoveragePing(
    db,
    makePing({
      lastSyncAt: '2026-09-01T10:00:00Z',
      windowStart: '2026-09-01T09:00:00Z',
      windowEnd: '2026-09-01T10:00:00Z',
    }),
  );
  await putCoveragePing(
    db,
    makePing({
      observerId: 'gcal',
      lastSyncAt: '2026-12-31T10:00:00Z',
      windowStart: '2026-12-31T09:00:00Z',
      windowEnd: '2026-12-31T10:00:00Z',
    }),
  );
}

const ids = async (table: 'claims' | 'receipts' | 'observations' | 'requests') =>
  (await db.table(table).toCollection().primaryKeys()).map(String).sort();
const sorted = (values: readonly string[]) => [...values].sort();
const intervals = async () =>
  (await db.coverageIntervals.toArray()).flatMap((row) => {
    const placed = readInterval(row);
    return placed === undefined
      ? []
      : [[placed.entry.observerId, placed.entry.windowStart, placed.entry.windowEnd]];
  });

/** Cut at the cutoff only: the event after it (O.later) is kept, so nothing after the cutoff is forgotten. */
const KEPT_INTERVALS = [
  `gmail ${CUTOFF} 2026-10-10T00:00:00Z`,
  'gmail 2026-12-01T00:00:00Z 2026-12-31T00:00:00Z',
  `gcal ${CUTOFF} 2026-10-20T00:00:00Z`,
  'gcal.week 2026-10-04T00:00:00Z 2026-10-05T10:00:00Z',
];

describe('purgeExpired removes exactly the old rows', () => {
  it('leaves exactly the kept rows in every dated table, and reports what went', async () => {
    await seed();
    const report = await purgeExpired(db, { now: NOW });
    expect(RETENTION_DAYS).toBe(90);
    expect(await ids('claims')).toEqual(sorted([C.fresh.id, C.edge.id, C.calendar.id].map(String)));
    expect(await ids('receipts')).toEqual(
      sorted([R.fresh.id, R.edge.id, R.calendar.id, R.scopeFresh.id].map(String)),
    );
    expect(await ids('observations')).toEqual(
      sorted([O.fresh.id, O.edge.id, O.freeFresh.id, O.later.id].map(String)),
    );
    expect(await ids('requests')).toEqual(sorted([Q.fresh.id, Q.edge.id].map(String)));
    expect(sorted((await intervals()).map((row) => row.join(' ')))).toEqual(sorted(KEPT_INTERVALS));
    const pings = readRows('coverage', CoveragePing, await db.coverage.toArray());
    expect(pings.map((ping) => ping.observerId)).toEqual(['gcal']);
    expect(report).toEqual({
      cutoff: CUTOFF,
      claims: 2,
      receipts: 4,
      observations: 2,
      requests: 2,
      coverageDeleted: 1,
      coverageCut: 2,
      coveragePings: 1,
      calendarSnapshots: 0,
      // No batch stored replay records for these receipts (tests/unit/ledger/replay-records.spec.ts purges some).
      receiptInputs: 0,
      policies: 0,
    });
  });

  it('keeps every kept row exactly as stored, and a second purge removes nothing', async () => {
    await seed();
    await purgeExpired(db, { now: NOW });
    expect(await getObservation(db, O.edge.id)).toEqual(O.edge);
    const before = {
      claims: await ids('claims'),
      observations: await ids('observations'),
      cov: await intervals(),
    };
    const again = await purgeExpired(db, { now: NOW });
    expect(again).toMatchObject({
      claims: 0,
      receipts: 0,
      observations: 0,
      requests: 0,
      coverageDeleted: 0,
      coverageCut: 0,
      coveragePings: 0,
    });
    expect({
      claims: await ids('claims'),
      observations: await ids('observations'),
      cov: await intervals(),
    }).toEqual(before);
  });
});

describe('purgeExpired: arguments', () => {
  it('refuses a malformed now or retention and deletes nothing', async () => {
    await seed();
    await expectLedgerError(purgeExpired(db, { now: '2027-01-01' }), 'invalid_input');
    for (const retentionDays of [0, -90, 1.5, Number.NaN]) {
      await expectLedgerError(purgeExpired(db, { now: NOW, retentionDays }), 'invalid_input');
    }
    expect(await ids('observations')).toHaveLength(Object.keys(O).length);
  });
});

describe('after a purge, nothing kept can grade what the ledger forgot (Hard Rule 5)', () => {
  it('a kept claim whose window reaches before the cutoff keeps its evidence and is only partly covered', async () => {
    await seed();
    await purgeExpired(db, { now: NOW });
    const edge = Claim.parse(C.edge);
    expect(await candidates(edge, createLedgerIndex(db), DEFAULT_POLICY)).toEqual([O.edge]);
    const grant = Grant.parse(makeGrant({ accounts: { 'gmail.sent': [sha(900)] } }));
    const coverage = await coverageForClaim(db, edge, NOW, DEFAULT_POLICY);
    expect(coverageLevel(edge, grant, coverage, DEFAULT_POLICY).level).toBe('partial');
  });

  it('an event after the cutoff stays with its old claim: a next pass or a re-sighting never makes it new', async () => {
    await seed();
    await purgeExpired(db, { now: NOW });
    // "Created the event" claimed on Oct 4, after the event was first seen (Sep 25): never its evidence (§4.1).
    const later = Claim.parse(
      makeClaim({
        rawHash: sha(190),
        type: 'calendar.created',
        claimedAt: '2026-10-04T10:00:00Z',
        observedAt: '2026-10-04T10:00:00Z',
        targetAt: '2026-10-07T10:00:00Z',
      }),
    );
    const grant = Grant.parse(makeGrant({ accounts: { 'gcal.event': [sha(900)] } }));
    const level = async () =>
      coverageLevel(later, grant, await coverageForClaim(db, later, NOW, DEFAULT_POLICY), DEFAULT_POLICY)
        .level;
    expect(await level()).toBe('full');
    // The next Calendar pass over that week, and the event sighted again: the ledger still holds its first sighting.
    await recordCoverage(db, gcal('2026-10-04T00:00:00Z', '2026-10-06T00:00:00Z'));
    pinClock(NOW);
    await upsertObservation(db, { ...O.later, observedAt: NOW }, DEFAULT_POLICY);
    expect(await getObservation(db, O.later.id)).toEqual(O.later);
    expect(await level()).toBe('full');
    expect(await candidates(later, createLedgerIndex(db), DEFAULT_POLICY)).toEqual([]);
  });

  it('a claim inside retention after the cutoff is still fully covered', async () => {
    await seed();
    await purgeExpired(db, { now: NOW });
    const later = Claim.parse(claim(9, '2026-10-06T10:00:00Z'));
    const grant = Grant.parse(makeGrant({ accounts: { 'gmail.sent': [sha(900)] } }));
    const coverage = await coverageForClaim(db, later, NOW, DEFAULT_POLICY);
    expect(coverageLevel(later, grant, coverage, DEFAULT_POLICY).level).toBe('full');
  });
});
