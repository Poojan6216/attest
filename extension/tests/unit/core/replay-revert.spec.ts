/**
 * A revert never erases what a batch saw (docs/grading.md §4.3, §8, §9; Hard Rule 4). On the hand-built ledger of
 * tests/tools/attest-scenario.ts, overrides that the batch at T2 graded under are reverted afterwards, or just
 * before T2 reads them, or at T2's very instant; each time replay reproduces every receipt, the next batch grades
 * without `fixed_conflict`, and replay still reproduces everything after it. Also: batches at one instant are
 * refused (by LedgerSim, which plays the background, and by `gradeBatch` itself: `stale_evaluated_at`).
 */
import { describe, expect, it } from 'vitest';

import { gradeBatch, preAssignments } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { replay } from '../../../src/core/replay';
import { IsoTs, type Receipt, type Ulid } from '../../../src/core/schema';
import { transition } from '../../../src/core/state';
import { LedgerSim } from '../../tools/attest-ledger';
import {
  CLAIMS,
  OBSERVATIONS,
  OVERRIDE_AT,
  receiptIdOf,
  type ReceiptRef,
  scenarioLedger,
  scenarioWorld,
  T1,
  T2,
  T2_MS,
} from '../../tools/attest-scenario';
import { buildClaim, isoAt, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../../tools/attest-world';

const T3 = isoAt(T2_MS + MS_PER_DAY, 0);
const REVERT_AT = isoAt(T2_MS + MS_PER_HOUR, 0);
/** Stamped after T2's instant but before the batch at T2 reads (the race §3 allows). */
const RACING_T2 = isoAt(T2_MS + 5_000, 0);

async function mismatches(sim: LedgerSim): Promise<readonly unknown[]> {
  return (await replay(sim.snapshot())).mismatches;
}

function receipt(sim: LedgerSim, ref: ReceiptRef): Receipt {
  const found = sim.receipts.get(receiptIdOf(ref));
  if (found === undefined) throw new Error(`no receipt ${ref}`);
  return found;
}

/** The claim of `ref`'s receipt that holds `observation`, as a scenario name, or null. */
const holder = (sim: LedgerSim, observation: Ulid): string | null => {
  const names = new Map(Object.entries(CLAIMS).map(([ref, claim]) => [claim.id, ref]));
  const holding = [...sim.receipts.values()].filter(
    (r) => r.claimId !== undefined && r.observationIds.includes(observation) && r.state === 'FINAL',
  );
  return holding.map((r) => names.get(r.claimId ?? r.id) ?? r.id).join(',') || null;
};

/** The scenario ledger plus T2's reverts, then T3; replay is exact before and after T3. */
async function revertAfterT2(ref: ReceiptRef): Promise<LedgerSim> {
  const { sim } = await scenarioLedger();
  expect(await mismatches(sim)).toEqual([]);
  sim.revert(receiptIdOf(ref), REVERT_AT);
  expect(await mismatches(sim)).toEqual([]);
  await sim.grade(T3, sim.world.policyAt(0).policy);
  expect(await mismatches(sim)).toEqual([]);
  return sim;
}

describe('a revert after a batch graded under the override (the verifier’s c7, u9 and c5)', () => {
  it('c7 (FINAL, released to NOT_FOUND; c8 took o7 at T2): o7 stays with c8, c7 never holds it again', async () => {
    const sim = await revertAfterT2('c7');
    expect(receipt(sim, 'c7')).toMatchObject({ state: 'FINAL', grade: 'VERIFIED' });
    expect(receipt(sim, 'c7').reverted).toMatchObject([
      { grade: 'NOT_FOUND', at: OVERRIDE_AT, revertedAt: REVERT_AT },
    ]);
    expect(holder(sim, OBSERVATIONS.o7.id)).toContain('c8');
    const c7 = preAssignments(sim.receipts.values()).filter((pair) => pair.claimId === CLAIMS.c7.id);
    expect(c7).toEqual([
      {
        observationId: OBSERVATIONS.o7.id,
        claimId: CLAIMS.c7.id,
        after: T1,
        released: [{ from: OVERRIDE_AT }],
      },
    ]);
  });

  it('u9 (UNASKED, taken at T2 so c10 was NOT_FOUND): o9 taken up to the revert, free after it', async () => {
    const sim = await revertAfterT2('u9');
    const taken = preAssignments(sim.receipts.values()).filter((pair) => pair.claimId === null);
    expect(taken).toEqual([
      { observationId: OBSERVATIONS.o9.id, claimId: null, after: OVERRIDE_AT, until: REVERT_AT },
    ]);
    expect(receipt(sim, 'c10').grade).toBe('NOT_FOUND');
  });

  it('c5 (PENDING, overridden to VERIFIED, so c6 was NOT_FOUND at T2): c5 is graded again at T3', async () => {
    const sim = await revertAfterT2('c5');
    expect(receipt(sim, 'c5').computedAt).toBe(T3);
    expect(receipt(sim, 'c5').reverted).toMatchObject([
      { grade: 'VERIFIED', previousState: 'PENDING', computedAt: T1 },
    ]);
    expect(receipt(sim, 'c6')).toMatchObject({ grade: 'NOT_FOUND', computedAt: T2 });
  });
});

/** T1, the scenario's overrides, `before` (applied before T2 reads), T2, T3: replay exact at every step. */
async function racing(before: (sim: LedgerSim) => void): Promise<LedgerSim> {
  const world = scenarioWorld();
  const sim = new LedgerSim(world);
  const { policy } = world.policyAt(0);
  await sim.grade(T1, policy);
  for (const [ref, grade] of [
    ['c5', 'VERIFIED'],
    ['c7', 'NOT_FOUND'],
    ['u9', 'VERIFIED'],
  ] as const) {
    sim.override(receiptIdOf(ref), grade, OVERRIDE_AT);
  }
  before(sim);
  await sim.grade(T2, policy);
  expect(await mismatches(sim)).toEqual([]);
  await sim.grade(T3, policy);
  expect(await mismatches(sim)).toEqual([]);
  return sim;
}

describe('reverts that race the batch at T2', () => {
  it('a revert stamped after T2 but read by it: the override still holds at T2 (c5 left out, o5 fixed to it)', async () => {
    const sim = await racing((s) => {
      s.revert(receiptIdOf('c5'), RACING_T2);
    });
    expect(receipt(sim, 'c6')).toMatchObject({ grade: 'NOT_FOUND', computedAt: T2 });
    expect(receipt(sim, 'c5').computedAt).toBe(T3);
  });

  it('a claim held out by a reverted override is refused by gradeBatch and by regrade (Hard Rule 6)', async () => {
    const world = scenarioWorld();
    const sim = new LedgerSim(world);
    const { policy } = world.policyAt(0);
    await sim.grade(T1, policy);
    sim.override(receiptIdOf('c5'), 'VERIFIED', OVERRIDE_AT);
    sim.revert(receiptIdOf('c5'), RACING_T2);
    const fixed = preAssignments(sim.receipts.values());
    const coverage = sim.coverageAt(T2);
    const index = createMemoryIndex(world.observations, 15);
    const claims = [CLAIMS.c5];
    await expect(
      gradeBatch(claims, index, world.grants, policy, coverage, { ...world.activity, claims }, fixed),
    ).rejects.toMatchObject({ name: 'BatchError', code: 'claim_fixed' });
    const [graded] = await gradeBatch(
      claims,
      index,
      world.grants,
      policy,
      coverage,
      { ...world.activity, claims },
      [],
    );
    const next = graded?.receipt;
    if (next === undefined) throw new Error('no receipt');
    expect(() => transition(receipt(sim, 'c5'), { event: 'regrade', next })).toThrow(
      expect.objectContaining({ code: 'regrade_held' }),
    );
  });
});

describe('reverts and what they fix again', () => {
  it('an override to NOT_FOUND reverted at T2’s very instant, then an override to VERIFIED after T2: never fixed twice', async () => {
    // c5 is held out at T2 by its reverted NOT_FOUND override, which fixed nothing, so c6 takes o5 FINAL at T2. The
    // override to VERIFIED that follows holds c5 only from that revert on, and o5 is c6's by then: c5 fixes nothing.
    const world = scenarioWorld();
    const sim = new LedgerSim(world);
    const { policy } = world.policyAt(0);
    await sim.grade(T1, policy);
    sim.override(receiptIdOf('c5'), 'NOT_FOUND', OVERRIDE_AT);
    sim.revert(receiptIdOf('c5'), T2);
    await sim.grade(T2, policy);
    sim.override(receiptIdOf('c5'), 'VERIFIED', T2);
    expect(await mismatches(sim)).toEqual([]);
    expect(receipt(sim, 'c6')).toMatchObject({ grade: 'VERIFIED', state: 'FINAL' });
    const c5 = preAssignments(sim.receipts.values()).filter((pair) => pair.claimId === CLAIMS.c5.id);
    expect(c5).toEqual([
      { observationId: OBSERVATIONS.o5.id, claimId: CLAIMS.c5.id, after: T1, released: [{ from: T1 }] },
    ]);
    await sim.grade(T3, policy);
    expect(await mismatches(sim)).toEqual([]);
  });

  it('a FINAL release reverted while no other claim took the observation fixes it again', async () => {
    const base = scenarioWorld();
    const c13 = buildClaim(13, {
      agent: 'muse',
      type: 'email.sent',
      counterparty: 'priya@acme.io',
      subjectHint: 'q3 deck',
      claimedAt: isoAt(Date.parse(T1) - 180 * MS_PER_MINUTE, 0),
      observedAt: isoAt(T2_MS + 2 * MS_PER_HOUR, 0),
    });
    const world = { ...base, claims: [...base.claims.filter((claim) => claim !== CLAIMS.c2), c13] };
    const sim = new LedgerSim(world);
    const { policy } = world.policyAt(0);
    await sim.grade(T1, policy);
    sim.override(receiptIdOf('c1'), 'NOT_FOUND', OVERRIDE_AT);
    await sim.grade(T2, policy);
    sim.revert(receiptIdOf('c1'), REVERT_AT);
    await sim.grade(T3, policy);
    expect(await mismatches(sim)).toEqual([]);
    const c1 = preAssignments(sim.receipts.values()).filter((pair) => pair.claimId === CLAIMS.c1.id);
    expect(c1).toEqual([
      {
        observationId: OBSERVATIONS.o1.id,
        claimId: CLAIMS.c1.id,
        after: T1,
        released: [{ from: OVERRIDE_AT, to: REVERT_AT }],
      },
    ]);
    const c13Receipt = [...sim.receipts.values()].find((r) => r.claimId === c13.id);
    expect(c13Receipt?.observationIds).toEqual([]);
  });
});

describe('a claim held out of a batch by a reverted override to NOT_FOUND (it fixed nothing)', () => {
  /** c14 restates o3 less well than c3 (claimed 70 minutes before T1, like c4) and is first seen after T1. */
  const c14 = buildClaim(14, {
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'bob@acme.io',
    subjectHint: 'invoice',
    claimedAt: isoAt(Date.parse(T1) - 70 * MS_PER_MINUTE, 0),
    observedAt: isoAt(Date.parse(T1) + 2 * MS_PER_HOUR, 0),
  });

  /** c3 (PENDING at T1, holding o3) overridden to NOT_FOUND at `overrideAt`, reverted at `revertAt`, then T2, T3. */
  async function heldAtT2(overrideAt: string, revertAt: string): Promise<LedgerSim> {
    const base = scenarioWorld();
    const world = { ...base, claims: [...base.claims, c14] };
    const sim = new LedgerSim(world);
    const { policy } = world.policyAt(0);
    await sim.grade(T1, policy);
    expect(receipt(sim, 'c3')).toMatchObject({ state: 'PENDING', observationIds: [OBSERVATIONS.o3.id] });
    sim.override(receiptIdOf('c3'), 'NOT_FOUND', overrideAt);
    sim.revert(receiptIdOf('c3'), revertAt);
    await sim.grade(T2, policy);
    // c3 was left out of T2, so o3 was free there: c14 took it, FINAL at T2.
    expect(receipt(sim, 'c3').computedAt).toBe(T1);
    const held = [...sim.receipts.values()].find((r) => r.claimId === c14.id);
    expect(held).toMatchObject({ computedAt: T2, state: 'FINAL', observationIds: [OBSERVATIONS.o3.id] });
    expect(await mismatches(sim)).toEqual([]);
    await sim.grade(T3, policy);
    // Graded again once the revert no longer holds it; replay leaves it out of T2 all the same.
    expect(receipt(sim, 'c3')).toMatchObject({ computedAt: T3, observationIds: [] });
    expect(await mismatches(sim)).toEqual([]);
    return sim;
  }

  it('reverted after T2 but read by it: held from its grading (T1) up to the revert', async () => {
    await heldAtT2(OVERRIDE_AT, RACING_T2);
  });

  it('overridden and reverted after T2, both read by it: held from its grading, not from the override', async () => {
    await heldAtT2(RACING_T2, isoAt(T2_MS + 6_000, 0));
  });
});

describe('a PENDING UNASKED receipt whose override a batch read, reverted', () => {
  it('is kept when a later batch no longer produces it, and is never regraded once superseded', async () => {
    // muse's adapter has not synced since o9, so its UNASKED receipt stays PENDING (§7). c15 restates o9 and is
    // first seen after the revert: it takes o9 at T3, so T3 no longer produces the UNASKED receipt.
    const base = scenarioWorld();
    const o9Ms = Date.parse(OBSERVATIONS.o9.occurredAt);
    const c15 = buildClaim(15, {
      agent: 'muse',
      type: 'email.sent',
      counterparty: 'erin@acme.io',
      subjectHint: 'hello',
      claimedAt: OBSERVATIONS.o9.occurredAt,
      observedAt: isoAt(T2_MS + 2 * MS_PER_HOUR, 0),
    });
    const activity = {
      ...base.activity,
      adapterSyncs: [{ agent: 'muse' as const, lastSyncAt: IsoTs.parse(isoAt(o9Ms + MS_PER_MINUTE, 0)) }],
    };
    const world = { ...base, claims: [...base.claims, c15], activity };
    const sim = new LedgerSim(world);
    const { policy } = world.policyAt(0);
    await sim.grade(T1, policy);
    expect(receipt(sim, 'u9')).toMatchObject({ grade: 'UNASKED', state: 'PENDING' });
    sim.override(receiptIdOf('u9'), 'VERIFIED', OVERRIDE_AT);
    await sim.grade(T2, policy);
    // o9 was taken at T2: c10, which restates it, was graded NOT_FOUND there.
    expect(receipt(sim, 'c10')).toMatchObject({ grade: 'NOT_FOUND', state: 'FINAL', computedAt: T2 });
    sim.revert(receiptIdOf('u9'), REVERT_AT);
    await sim.grade(T3, policy);
    expect([...sim.receipts.values()].find((r) => r.claimId === c15.id)?.observationIds).toEqual([
      OBSERVATIONS.o9.id,
    ]);
    // Not produced at T3, yet kept: the batch at T2 had its orphan taken, and replay must still see that.
    expect(receipt(sim, 'u9')).toMatchObject({ state: 'PENDING', computedAt: T1 });
    expect(await mismatches(sim)).toEqual([]);
    sim.supersede();
    expect(receipt(sim, 'u9').supersededBy).toBe(c15.id);
    // c15 lets o9 go: T4 produces the UNASKED receipt again, and the superseded row is kept as stored.
    const c15Id = [...sim.receipts.values()].find((r) => r.claimId === c15.id)?.id;
    if (c15Id === undefined) throw new Error('no c15 receipt');
    sim.override(c15Id, 'NOT_FOUND', isoAt(T2_MS + 1.5 * MS_PER_DAY, 0));
    await sim.grade(isoAt(T2_MS + 2 * MS_PER_DAY, 0), policy);
    expect(receipt(sim, 'u9')).toMatchObject({ state: 'PENDING', computedAt: T1, supersededBy: c15.id });
    expect(await mismatches(sim)).toEqual([]);
  });
});

describe('batches are stamped strictly in order (§3)', () => {
  /** The verifier’s same-instant probe: c9, a muse claim of o9, graded at T1, then a second batch at T1. */
  it('a second batch at T1 is refused, by LedgerSim and by gradeBatch (stale_evaluated_at), and changes nothing', async () => {
    const base = scenarioWorld();
    const c9 = buildClaim(99, {
      agent: 'muse',
      type: 'email.sent',
      counterparty: 'erin@acme.io',
      subjectHint: 'hello',
      claimedAt: isoAt(Date.parse(T1) - 300 * MS_PER_MINUTE, 0),
      observedAt: isoAt(Date.parse(T1) - 290 * MS_PER_MINUTE, 0),
    });
    const world = { ...base, claims: [...base.claims, c9] };
    const { policy } = world.policyAt(0);
    const sim = new LedgerSim(world);
    await sim.grade(T1, policy);
    expect(await mismatches(sim)).toEqual([]);
    const before = JSON.stringify([...sim.receipts]);
    await expect(sim.grade(T1, policy)).rejects.toThrow('is not after the last batch');
    expect(JSON.stringify([...sim.receipts])).toBe(before);
    const run = (at: string) =>
      gradeBatch(
        [],
        createMemoryIndex(world.observations, 15),
        world.grants,
        policy,
        sim.coverageAt(at),
        { ...world.activity, claims: world.claims },
        preAssignments(sim.receipts.values()),
      );
    await expect(run(T1)).rejects.toMatchObject({ name: 'BatchError', code: 'stale_evaluated_at' });
    await expect(run(isoAt(Date.parse(T1) - 1, 0))).rejects.toMatchObject({ code: 'stale_evaluated_at' });
    const later = await run(isoAt(Date.parse(T1) + 1, 0));
    expect(later.filter(({ receipt: r }) => r.grade === 'UNASKED')).toEqual([]);
  });
});
