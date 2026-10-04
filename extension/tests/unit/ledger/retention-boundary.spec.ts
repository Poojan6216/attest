/**
 * The retention purge at its edges (src/ledger/retention.ts; Decisions [2.6]). Done-when "a purge removes exactly the
 * old rows", to the millisecond: in every dated table a row 1 ms before the cutoff goes and a row at the cutoff
 * stays, whatever offset it was written in (the `[agent+date]` index holds the writer's local date, up to a day off
 * the UTC one), and in the last time bucket before the cutoff. Current evidence keeps its explanation (rule 3),
 * including through `supersededBy`, and the report counts the rows that went, not the ids a receipt named.
 *
 * Now 2027-01-01T12:00Z, 90 days: the cutoff is 2026-10-03T12:00:00.000Z.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { readInterval, recordCoverage } from '../../../src/ledger/coverage';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  putCoveragePing,
  putReceipt,
  putRequest,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import { purgeExpired } from '../../../src/ledger/retention';
import { CoveragePing } from '../../../src/ledger/types';
import {
  claimId,
  makeClaim,
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
/** 1 ms before the cutoff, written at +14:00: its local date (Oct 4) is a day after its UTC date. */
const JUST_BEFORE = '2026-10-04T01:59:59.999+14:00';
/** The cutoff itself, written at -12:00: its local date (Oct 3) is the UTC date, its local time midnight. */
const AT_CUTOFF = '2026-10-03T00:00:00-12:00';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('retention-boundary'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const ids = async (table: 'claims' | 'receipts' | 'observations' | 'requests') =>
  (await db.table(table).toCollection().primaryKeys()).map(String).sort();
const sorted = (values: readonly string[]) => [...values].sort();

const obs = (n: number, occurredAt: string, extra: Record<string, unknown> = {}) =>
  makeObservation({ rowKeyHash: sha(n), occurredAt, observedAt: occurredAt, ...extra });
const claim = (n: number, claimedAt: string, extra: Record<string, unknown> = {}) =>
  makeClaim({ rawHash: sha(100 + n), claimedAt, observedAt: claimedAt, requestId: undefined, ...extra });
const receipt = (n: number, computedAt: string, observationIds: string[] = []) =>
  makeReceipt({
    id: ulid(300 + n),
    claimId: claimId(100 + n),
    requestId: undefined,
    observationIds,
    reasons: [],
    computedAt,
  });

/** A Gmail Sent pass from Sep 30 to `windowEnd`, synced then. */
const pass = (observerId: string, windowEnd: string) => ({
  observerId,
  source: 'gmail.sent' as const,
  accountHash: sha(900),
  windowStart: '2026-09-30T00:00:00Z',
  windowEnd,
  lastSyncAt: windowEnd,
});

/** An UNASKED receipt of `observationId`, superseded by `supersededBy` when given. */
const unasked = (n: number, computedAt: string, observationId: string, supersededBy?: string) =>
  makeReceipt({
    id: ulid(300 + n),
    claimId: undefined,
    requestId: undefined,
    grade: 'UNASKED',
    attribution: 'likely',
    ruleId: 'unasked',
    reasons: supersededBy === undefined ? [] : [{ code: 'superseded', params: { claimId: supersededBy } }],
    supersededBy,
    observationIds: [observationId],
    computedAt,
  });

describe('a row 1 ms before the cutoff goes, a row at the cutoff stays, in any offset', () => {
  it('claims, receipts, observations and requests', async () => {
    const before = obs(1, JUST_BEFORE);
    const at = obs(2, AT_CUTOFF);
    for (const o of [before, at]) await upsertObservation(db, o, DEFAULT_POLICY);
    // Claims with no receipt; a receipt computed 1 ms before the cutoff takes its fresh claim with it (rule 2).
    const claims = [
      claim(1, JUST_BEFORE),
      claim(2, AT_CUTOFF),
      claim(3, '2026-10-04T10:00:00Z'),
      claim(4, '2026-10-04T10:00:00Z'),
    ];
    for (const c of claims) await upsertClaim(db, c);
    await putReceipt(db, receipt(3, JUST_BEFORE));
    await putReceipt(db, receipt(4, AT_CUTOFF));
    await putRequest(db, makeRequest({ id: ulid(201), ts: JUST_BEFORE }));
    await putRequest(db, makeRequest({ id: ulid(202), ts: AT_CUTOFF }));

    const report = await purgeExpired(db, { now: NOW });
    expect(await ids('observations')).toEqual([at.id]);
    expect(await ids('claims')).toEqual(sorted([claimId(102), claimId(104)]));
    expect(await ids('receipts')).toEqual([ulid(304)]);
    expect(await ids('requests')).toEqual([ulid(202)]);
    expect(report).toMatchObject({ claims: 2, receipts: 1, observations: 1, requests: 1 });
  });

  it("an observation in the cutoff's own time bucket, 1 ms before it, goes", async () => {
    // Now 12:30: the cutoff (12:30) falls inside a one-hour bucket that starts at 12:00.
    const inBucket = obs(1, '2026-10-04T02:29:59.999+14:00');
    const at = obs(2, '2026-10-03T12:30:00Z');
    for (const o of [inBucket, at]) await upsertObservation(db, o, DEFAULT_POLICY);
    await purgeExpired(db, { now: '2027-01-01T12:30:00Z' });
    expect(await ids('observations')).toEqual([at.id]);
  });

  it('coverage: an interval ending 1 ms before the cutoff goes, one ending at it keeps that instant', async () => {
    await recordCoverage(db, pass('gmail', JUST_BEFORE));
    await recordCoverage(db, pass('gmail.second', AT_CUTOFF));
    await putCoveragePing(db, makePing({ observerId: 'gmail', lastSyncAt: JUST_BEFORE }));
    await putCoveragePing(db, makePing({ observerId: 'gmail.second', lastSyncAt: AT_CUTOFF }));

    const report = await purgeExpired(db, { now: NOW });
    const left = (await db.coverageIntervals.toArray()).flatMap((row) => {
      const placed = readInterval(row);
      return placed === undefined ? [] : [[placed.entry.observerId, placed.startMs, placed.endMs]];
    });
    const cutoffMs = Date.parse(AT_CUTOFF);
    expect(left).toEqual([['gmail.second', cutoffMs, cutoffMs]]);
    const pings = readRows('coverage', CoveragePing, await db.coverage.toArray());
    expect(pings.map((ping) => ping.observerId)).toEqual(['gmail.second']);
    expect(report).toMatchObject({ coverageDeleted: 1, coverageCut: 1, coveragePings: 1 });
  });
});

describe('current evidence keeps its explanation (rule 3)', () => {
  it('a receipt naming evidence exactly at the cutoff stays, with its old claim', async () => {
    const evidence = obs(1, AT_CUTOFF);
    await upsertObservation(db, evidence, DEFAULT_POLICY);
    await upsertClaim(db, claim(1, '2026-09-20T10:00:00Z'));
    await putReceipt(db, receipt(1, '2026-09-20T10:31:00Z', [evidence.id]));

    const report = await purgeExpired(db, { now: NOW });
    expect(await ids('claims')).toEqual([claimId(101)]);
    expect(await ids('receipts')).toEqual([ulid(301)]);
    expect(await ids('observations')).toEqual([evidence.id]);
    expect(report).toMatchObject({ claims: 0, receipts: 0, observations: 0 });
  });

  it('a kept UNASKED receipt keeps the claim that superseded it, and that claim its receipt and evidence', async () => {
    const event = obs(1, '2026-10-10T10:00:00Z', { source: 'gcal.event', type: 'calendar.created' });
    const oldSend = obs(2, '2026-09-20T10:00:00Z');
    for (const o of [event, oldSend]) await upsertObservation(db, o, DEFAULT_POLICY);
    await upsertClaim(db, claim(1, '2026-09-20T10:00:00Z'));
    await putReceipt(db, receipt(1, '2026-09-20T10:31:00Z', [oldSend.id]));
    // Superseded by the old claim, and named current evidence: no kept row may name a purged claim.
    await putReceipt(db, unasked(5, '2026-09-20T10:00:00Z', event.id, claimId(101)));

    await purgeExpired(db, { now: NOW });
    expect(await ids('claims')).toEqual([claimId(101)]);
    expect(await ids('receipts')).toEqual(sorted([ulid(301), ulid(305)]));
    expect(await ids('observations')).toEqual(sorted([event.id, oldSend.id]));
  });

  it('counts the claims that went, not the claim ids a purged receipt named', async () => {
    // A receipt whose claim the ledger does not hold (a claim-less ledger row would be the same).
    await putReceipt(db, receipt(9, '2026-09-20T10:31:00Z'));
    await upsertClaim(db, claim(1, '2026-09-20T10:00:00Z'));
    const report = await purgeExpired(db, { now: NOW });
    expect(report).toMatchObject({ claims: 1, receipts: 1 });
    expect(await ids('claims')).toEqual([]);
    expect(await ids('receipts')).toEqual([]);
  });
});

describe('a row joined only through a kept one stays (rule 2 after rule 3)', () => {
  it('an UNASKED receipt computed after the cutoff stays when the old claim that superseded it is kept', async () => {
    const event = obs(1, '2026-10-10T10:00:00Z', { source: 'gcal.event', type: 'calendar.created' });
    const oldSend = obs(2, '2026-10-03T11:00:00Z');
    for (const o of [event, oldSend]) await upsertObservation(db, o, DEFAULT_POLICY);
    // An old claim with no receipt, superseding two receipts graded at the cutoff: one names current evidence.
    await upsertClaim(db, claim(1, '2026-10-03T11:00:00Z'));
    await putReceipt(db, unasked(5, AT_CUTOFF, event.id, claimId(101)));
    await putReceipt(db, unasked(6, AT_CUTOFF, oldSend.id, claimId(101)));

    const report = await purgeExpired(db, { now: NOW });
    expect(await ids('claims')).toEqual([claimId(101)]);
    expect(await ids('receipts')).toEqual(sorted([ulid(305), ulid(306)]));
    expect(await ids('observations')).toEqual(sorted([event.id, oldSend.id]));
    expect(report).toMatchObject({ claims: 0, receipts: 0, observations: 0 });
  });
});
