/**
 * The retention purge's invariants over random ledgers (src/ledger/retention.ts; Decisions [2.6]; Hard Rules 2, 5, 7).
 * Rows are dated a few days either side of the cutoff, in three offsets; receipts name random observations, UNASKED
 * receipts are superseded by random claims. After a purge:
 *  - nothing kept names a purged row: a kept receipt's evidence, its claim and the claim that superseded it are kept;
 *    a kept claim's receipts and its request are kept;
 *  - every observation at or after the cutoff is kept (current evidence keeps its explanation);
 *  - nothing goes that the rule does not reach: a purged claim is old or goes with a receipt that is, a purged receipt
 *    is old or goes with its claim or the claim that superseded it, a purged observation is old or was evidence of a
 *    purged receipt, a purged request is old;
 *  - no coverage interval starts before the cutoff, and a second purge removes nothing.
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { Claim, Observation, Receipt, Request } from '../../../src/core/schema';
import { readInterval, recordCoverage } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putReceipt, putRequest, upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import { purgeExpired } from '../../../src/ledger/retention';
import { isoAt } from '../../tools/attest-world';
import {
  claimId,
  makeClaim,
  makeObservation,
  makeReceipt,
  makeRequest,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

const RUNS = 150;
const NOW = '2027-01-01T12:00:00Z';
const CUTOFF_MS = Date.parse('2026-10-03T12:00:00Z');
const HOUR = 3_600_000;

/** An instant within five days of the cutoff (sometimes exactly on it, or 1 ms off), in one of three offsets. */
const instantArb = fc
  .record({
    hours: fc.integer({ min: -120, max: 120 }),
    edge: fc.constantFrom(0, 0, 0, -1, 1),
    offset: fc.constantFrom(-720, 0, 840),
  })
  .map(({ hours, edge, offset }) => isoAt(CUTOFF_MS + hours * HOUR + edge, offset));

const ledgerArb = fc.record({
  observations: fc.array(fc.record({ at: instantArb, calendar: fc.boolean() }), { maxLength: 6 }),
  claims: fc.array(
    fc.record({ at: instantArb, request: fc.option(fc.nat({ max: 3 }), { nil: undefined }) }),
    { maxLength: 5 },
  ),
  /** Per claim: a receipt (or none), its computedAt, and the observation it names (or none). */
  receipts: fc.array(
    fc.option(fc.record({ at: instantArb, names: fc.option(fc.nat(), { nil: undefined }) }), {
      nil: undefined,
    }),
    { maxLength: 5 },
  ),
  unasked: fc.array(
    fc.record({ at: instantArb, names: fc.nat(), by: fc.option(fc.nat(), { nil: undefined }) }),
    { maxLength: 3 },
  ),
  requests: fc.array(instantArb, { maxLength: 4 }),
  passes: fc.array(fc.tuple(instantArb, instantArb), { maxLength: 3 }),
});

type Ledger = typeof ledgerArb extends fc.Arbitrary<infer Value> ? Value : never;

function observationOf(n: number, at: string, calendar: boolean) {
  const kind = calendar ? ({ source: 'gcal.event', type: 'calendar.created' } as const) : {};
  return makeObservation({ rowKeyHash: sha(n + 1), occurredAt: at, observedAt: at, ...kind });
}

async function seed(db: LedgerDb, ledger: Ledger): Promise<void> {
  const observations = ledger.observations.map(({ at, calendar }, n) => observationOf(n, at, calendar));
  const pick = (k: number | undefined) =>
    k === undefined || observations.length === 0 ? [] : [observations[k % observations.length]?.id ?? ''];
  for (const o of observations) await upsertObservation(db, o, DEFAULT_POLICY);
  for (const [n, at] of ledger.requests.entries())
    await putRequest(db, makeRequest({ id: ulid(200 + n), ts: at }));
  for (const [n, { at, request }] of ledger.claims.entries()) {
    const requestId = request === undefined ? undefined : ulid(200 + request);
    await upsertClaim(db, makeClaim({ rawHash: sha(100 + n), claimedAt: at, observedAt: at, requestId }));
    const receipt = ledger.receipts[n];
    if (receipt === undefined) continue;
    const ids = pick(receipt.names);
    await putReceipt(
      db,
      makeReceipt({
        id: ulid(300 + n),
        claimId: claimId(100 + n),
        requestId,
        observationIds: ids,
        reasons: [],
        computedAt: receipt.at,
      }),
    );
  }
  for (const [n, { at, names, by }] of ledger.unasked.entries()) {
    const ids = pick(names);
    if (ids.length === 0) continue;
    const superseded =
      by === undefined || ledger.claims.length === 0 ? undefined : claimId(100 + (by % ledger.claims.length));
    await putReceipt(
      db,
      makeReceipt({
        id: ulid(400 + n),
        claimId: undefined,
        requestId: undefined,
        grade: 'UNASKED',
        attribution: 'likely',
        ruleId: 'unasked',
        reasons: superseded === undefined ? [] : [{ code: 'superseded', params: { claimId: superseded } }],
        supersededBy: superseded,
        observationIds: ids,
        computedAt: at,
      }),
    );
  }
  for (const [a, b] of ledger.passes) {
    const [windowStart, windowEnd] = Date.parse(a) <= Date.parse(b) ? [a, b] : [b, a];
    await recordCoverage(db, {
      observerId: 'gmail',
      source: 'gmail.sent',
      windowStart,
      windowEnd,
      lastSyncAt: windowEnd,
    });
  }
}

interface Snapshot {
  readonly claims: Map<string, Claim>;
  readonly receipts: Map<string, Receipt>;
  readonly observations: Map<string, Observation>;
  readonly requests: Map<string, Request>;
}

async function snapshot(db: LedgerDb): Promise<Snapshot> {
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  return {
    claims: byId(readRows('claims', Claim, await db.claims.toArray())),
    receipts: byId(readRows('receipts', Receipt, await db.receipts.toArray())),
    observations: byId(readRows('observations', Observation, await db.observations.toArray())),
    requests: byId(readRows('requests', Request, await db.requests.toArray())),
  };
}

const old = (at: string) => Date.parse(at) < CUTOFF_MS;

/** Nothing kept names a purged row, and current evidence is kept. */
function expectClosed(before: Snapshot, after: Snapshot): void {
  for (const receipt of after.receipts.values()) {
    for (const id of receipt.observationIds)
      if (before.observations.has(id)) expect(after.observations.has(id)).toBe(true);
    for (const id of [receipt.claimId, receipt.supersededBy]) {
      if (id !== undefined && before.claims.has(id)) expect(after.claims.has(id)).toBe(true);
    }
  }
  for (const claim of after.claims.values()) {
    for (const receipt of before.receipts.values())
      if (receipt.claimId === claim.id) expect(after.receipts.has(receipt.id)).toBe(true);
    if (claim.requestId !== undefined && before.requests.has(claim.requestId))
      expect(after.requests.has(claim.requestId)).toBe(true);
  }
  for (const observation of before.observations.values()) {
    if (!old(observation.occurredAt)) expect(after.observations.has(observation.id)).toBe(true);
  }
}

/** Nothing goes that the rule does not reach. */
function expectMinimal(before: Snapshot, after: Snapshot): void {
  const purged = <T>(table: Map<string, T>, kept: Map<string, T>) =>
    [...table.entries()].filter(([id]) => !kept.has(id)).map(([, row]) => row);
  const purgedClaims = new Set(purged(before.claims, after.claims).map(({ id }) => id));
  const purgedReceipts = purged(before.receipts, after.receipts);
  for (const claim of purged(before.claims, after.claims)) {
    const oldReceipt = purgedReceipts.some((r) => r.claimId === claim.id && old(r.computedAt));
    expect(old(claim.claimedAt) || oldReceipt).toBe(true);
  }
  for (const receipt of purgedReceipts) {
    const joined = [receipt.claimId, receipt.supersededBy].some(
      (id) => id !== undefined && purgedClaims.has(id),
    );
    expect(old(receipt.computedAt) || joined).toBe(true);
  }
  for (const observation of purged(before.observations, after.observations)) {
    const named = purgedReceipts.some((r) => r.observationIds.includes(observation.id));
    expect(old(observation.occurredAt) || named).toBe(true);
  }
  for (const request of purged(before.requests, after.requests)) expect(old(request.ts)).toBe(true);
}

let db: LedgerDb;
beforeAll(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('retention-property'));
});
afterAll(() => {
  db.close();
  releaseClock();
});

describe('purgeExpired keeps the ledger closed and removes only what the rule reaches (property)', () => {
  it('for random ledgers around the cutoff', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async (ledger) => {
        await Promise.all(db.tables.map((table) => table.clear()));
        await seed(db, ledger);
        const before = await snapshot(db);
        await purgeExpired(db, { now: NOW });
        const after = await snapshot(db);
        expectClosed(before, after);
        expectMinimal(before, after);
        for (const row of await db.coverageIntervals.toArray()) {
          expect(readInterval(row)?.startMs ?? CUTOFF_MS).toBeGreaterThanOrEqual(CUTOFF_MS);
        }
        expect(await purgeExpired(db, { now: NOW })).toMatchObject({
          claims: 0,
          receipts: 0,
          observations: 0,
          requests: 0,
          coverageDeleted: 0,
          coverageCut: 0,
        });
      }),
      { numRuns: RUNS },
    );
  }, 120_000);
});
