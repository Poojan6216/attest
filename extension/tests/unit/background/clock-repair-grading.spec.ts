import 'fake-indexeddb/auto';
/**
 * S2-SIM2-1 (sprint_3 3.17; docs/grading.md §3 Clock safety and §6.1, v1.16; Decisions [2.7-E], [3.17]; Hard Rules 4,
 * 5): a true `calendar.created` claim is never NOT_FOUND because the clock moved around it. The Sprint 2 simulator's
 * two clock moves (v1.11 Clock safety), each through the real Calendar handlers, clock guard, ledger and batch:
 *  - the clock ran three hours ahead while the claim was stamped, then came back: the event, first seen after the
 *    repair, reads as older than the claim;
 *  - the clock stepped back 110 minutes for good just after the claim: the event, first seen after the step, reads
 *    as older than the claim too.
 * Either way the repair keeps its span, the batch grades with it, and the claim is `partial_coverage` with
 * `coverage.clock_repaired` (UNVERIFIABLE once final), never NOT_FOUND; replay reproduces it from the export. The same
 * history graded without the kept span (what the v1.15 ledger gave grading) is NOT_FOUND, FINAL: the defect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDefaultGrants } from '../../../src/background/default-grants';
import { runGradingBatch } from '../../../src/background/grading';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { replay } from '../../../src/core/replay';
import { type IsoTs, Receipt } from '../../../src/core/schema';
import { CLOCK_REPAIR_PREFIX, clockRepairs } from '../../../src/ledger/clock-repairs';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { openLedger } from '../../../src/ledger/migrations';
import { upsertClaim } from '../../../src/ledger/repo';
import { readSnapshot } from '../../tools/attest-snapshot';
import { makeClaim, pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { at, type EventInput, week } from './calendar-fixtures';
import { eventOn, runPass, weekPing } from './calendar-pass-harness';
import { contextOf, type TestContext } from './observer-harness';

let db: LedgerDb;
let ctx: TestContext;
/** The one wall clock: the service worker's (`ctx.now()`), the ledger's and the batch's. */
let clock: IsoTs;

function setClock(now: IsoTs): void {
  clock = now;
  pinClock(now);
}

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('clock-repair-grading'));
  setClock(at(0));
  ctx = contextOf(db, { now: () => clock });
  await ensureDefaultGrants(db, at(0));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const standup = eventOn('s', '2026-10-06', 10, { subjectHint: 'Standup' });
const vendor = eventOn('v', '2026-10-07', 10, { subjectHint: 'Vendor call' });

/** A whole pass of the week, every calendar shown, read at `readAt` by a worker whose clock reads the same. */
async function pass(readAt: IsoTs, events: readonly EventInput[]): Promise<void> {
  setClock(readAt);
  const snapshot = week(events, { readAt, familyShown: true });
  const pings = [weekPing(readAt, { allCalendars: true })];
  expect(await runPass(ctx, snapshot, { pings })).toEqual({ ok: true });
}

/** Muse says it created "Vendor call" at `claimedAt`; the claim is read and stored at `observedAt`. */
async function claimVendor(claimedAt: IsoTs, observedAt: IsoTs): Promise<void> {
  setClock(observedAt);
  const claim = makeClaim({ type: 'calendar.created', subjectHint: 'Vendor call', claimedAt, observedAt });
  await upsertClaim(db, { ...claim, counterparty: undefined, targetAt: vendor.occurredAt });
}

/** A batch at `now`; the claim's receipt as [grade, rule, state, reason codes]. */
async function gradeAt(now: IsoTs): Promise<[string, string, string, string[]]> {
  setClock(now);
  const deps = {
    policy: DEFAULT_POLICY,
    policyDocument: DEFAULT_POLICY_DOCUMENT,
    nowMs: () => Date.parse(now),
  };
  expect(await runGradingBatch(db, deps)).not.toBeNull();
  const receipts = readRows('receipts', Receipt, await db.receipts.toArray()).filter((r) => r.claimId);
  expect(receipts).toHaveLength(1);
  const [receipt] = receipts;
  if (receipt === undefined) throw new Error('no claim receipt');
  return [receipt.grade, receipt.ruleId, receipt.state, receipt.reasons.map((reason) => reason.code)];
}

/** Grading as the v1.15 ledger did: without the spans the repairs kept. */
async function forgetSpans(): Promise<void> {
  await db.meta.where('key').startsWith(CLOCK_REPAIR_PREFIX).delete();
}

async function replayed(): Promise<unknown> {
  const exported = await exportLedger(db, { exportedAt: clock });
  return replay(readSnapshot(JSON.parse(JSON.stringify(exported))));
}

const CAPPED = ['coverage.partial', 'coverage.clock_repaired', 'match.none'];

/**
 * The clock reads three hours ahead from real 12:30 to 12:40 (the Calendar tab hidden meanwhile): the claim is stamped
 * 15:34 and stored at 15:35, then the clock comes back and the next pass, at 12:40, repairs and first sees the event.
 * The view at 16:10 is fresh: synced after the claim's grace sync, end(15:35) + 30 = 16:05.
 */
async function aheadAndBack(): Promise<void> {
  await pass(at(0), [standup]);
  await pass(at(20), [standup]);
  await claimVendor(at(214), at(215));
  await pass(at(40), [standup, vendor]);
  expect(await clockRepairs(db)).toEqual([{ from: at(40), to: at(215) }]);
  await pass(at(250), [standup, vendor]);
}

/**
 * The clock is right until real 16:00, then reads 110 minutes behind for good: the claim is stamped 15:55 and stored
 * at 15:56; the pass at 14:15 (real 16:05) repairs and first sees the event; the view at 16:30 (real 18:20) is fresh,
 * synced after end(15:56) + 30 = 16:26.
 */
async function steppedBack(): Promise<void> {
  await pass(at(0), [standup]);
  await pass(at(230), [standup]);
  await claimVendor(at(235), at(236));
  await pass(at(135), [standup, vendor]);
  expect(await clockRepairs(db)).toEqual([{ from: at(135), to: at(236) }]);
  await pass(at(270), [standup, vendor]);
}

describe('S2-SIM2-1: the clock ran ahead while the claim was stamped, then came back', () => {
  it('the claim is partial_coverage with coverage.clock_repaired, then UNVERIFIABLE; replay reproduces it', async () => {
    await aheadAndBack();
    expect(await gradeAt(at(255))).toEqual(['UNVERIFIABLE', 'partial_coverage', 'PENDING', CAPPED]);
    expect(await gradeAt(at(1700))).toEqual(['UNVERIFIABLE', 'partial_coverage', 'FINAL', CAPPED]);
    expect(await replayed()).toMatchObject({ reproduced: 1, mismatched: 0 });
  });

  it('without the kept span the same history is NOT_FOUND, FINAL', async () => {
    await aheadAndBack();
    await forgetSpans();
    expect((await gradeAt(at(255))).slice(0, 3)).toEqual(['NOT_FOUND', 'not_found', 'FINAL']);
  });
});

describe('S2-SIM2-1: the clock stepped back for good just after the claim', () => {
  it('the claim is partial_coverage with coverage.clock_repaired; replay reproduces it', async () => {
    await steppedBack();
    expect(await gradeAt(at(275))).toEqual(['UNVERIFIABLE', 'partial_coverage', 'PENDING', CAPPED]);
    expect(await replayed()).toMatchObject({ reproduced: 1, mismatched: 0 });
  });

  it('without the kept span the same history is NOT_FOUND, FINAL', async () => {
    await steppedBack();
    await forgetSpans();
    expect((await gradeAt(at(275))).slice(0, 3)).toEqual(['NOT_FOUND', 'not_found', 'FINAL']);
  });
});
