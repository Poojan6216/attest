/**
 * Replay property tests (docs/grading.md §9; task 1.9 Done-when; ledger_engineer rule 10: "random ledger → replay
 * reproduces all receipts").
 *
 * A random synthetic ledger is built by grading it the way the background does (tests/tools/attest-ledger.ts):
 * several batches over increasing evaluatedAt, every PENDING claim regraded in each, receipts finalising along the
 * way, FINAL and overridden receipts fixed in later batches, overrides between batches, a grant and a policy that
 * change mid-ledger. Then:
 *  - the Done-when ledger (1,000 claims, 10,000 observations): replay reproduces 100% of the receipts, and mutating
 *    one stored receipt's grade makes replay report exactly that one mismatch;
 *  - small ledgers (1–20 claims, 1–100 observations, 2–4 batches), 1,000 of them per property (qa_tester rule 4):
 *    the same for grade and ruleId, an inputsHash mismatch when one receipt's inputs row moves, a receiptInputs
 *    mismatch when one row is lost, and the same report whatever the input order.
 * The world mixes in rows read by a source the policy does not list for their type (attest-world.ts): such a row
 * neither verifies a claim nor accuses an agent, so no receipt names it, even inside a window of its own source (§3,
 * §4.1; Hard Rule 5). LedgerSim reads some claims first at a batch's very instant (that batch grades them, §3) and
 * stamps some overrides at a batch instant or just after one that batch then reads (batch-fixed.ts), so replay is
 * held to those boundaries too.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/core/hash';
import { DEFAULT_POLICY } from '../../src/core/policy';
import { observationIntegrityProblems } from '../../src/core/redact';
import { type LedgerSnapshot, replay, type ReplayReport } from '../../src/core/replay';
import { Grade, type Observation, type Receipt, Sha256 } from '../../src/core/schema';
import { simulate } from '../tools/attest-ledger';
import { sourceOf } from '../tools/attest-world';

const DONE_WHEN = { claims: 1_000, observations: 10_000 } as const;

/** A different grade than `grade`, chosen by `pick`. */
function otherGrade(grade: Grade, pick: number): Grade {
  const others = Grade.options.filter((option) => option !== grade);
  return others[pick % others.length] ?? 'UNVERIFIABLE';
}

function replaceReceipt(snapshot: LedgerSnapshot, target: Receipt, next: Receipt): LedgerSnapshot {
  return { ...snapshot, receipts: snapshot.receipts.map((receipt) => (receipt === target ? next : receipt)) };
}

function receiptAt(snapshot: LedgerSnapshot, pick: number): Receipt {
  const receipt = snapshot.receipts[pick % snapshot.receipts.length];
  if (receipt === undefined) throw new Error('empty ledger');
  return receipt;
}

function expectReproduced(report: ReplayReport, snapshot: LedgerSnapshot): void {
  expect(report.mismatches).toEqual([]);
  expect(report.reproduced).toBe(snapshot.receipts.length);
  expect(report.receipts).toBe(snapshot.receipts.length);
}

/** Whether `row` comes from a source the policy does not list for its type (attest-world's stray rows). */
const isStray = (row: Observation): boolean => row.source !== sourceOf(row.type);

/** Receipts naming a stray row: none, since such a row is neither a candidate (§4.1) nor an orphan (§3). */
function strayReceipts(snapshot: LedgerSnapshot): number {
  const stray = new Set(snapshot.observations.filter(isStray).map((row) => row.id));
  return snapshot.receipts.filter((receipt) => receipt.observationIds.some((id) => stray.has(id))).length;
}

/**
 * Stray rows first seen by the last batch, inside a window of a pass of their own source that a batch read: each
 * would be an orphan candidate if the policy's sources were not checked, so `strayReceipts` is not vacuous.
 */
function strayInOwnWindow(snapshot: LedgerSnapshot): number {
  const passes = [...snapshot.receiptInputs.values()].flatMap((inputs) => inputs.coverage.observers);
  const lastMs = Math.max(...snapshot.receipts.map((receipt) => Date.parse(receipt.computedAt)));
  return snapshot.observations.filter((row) => {
    const t = Date.parse(row.occurredAt);
    if (!isStray(row) || Date.parse(row.observedAt) > lastMs) return false;
    return passes.some(
      (pass) =>
        pass.source === row.source && Date.parse(pass.windowStart) <= t && t <= Date.parse(pass.windowEnd),
    );
  }).length;
}

/** Claims first read at the very instant of a batch (a receipt's `computedAt`): that batch graded them (§3). */
function readAtBatch(snapshot: LedgerSnapshot): number {
  const instants = new Set(snapshot.receipts.map((receipt) => Date.parse(receipt.computedAt)));
  return snapshot.claims.filter((claim) => instants.has(Date.parse(claim.observedAt))).length;
}

/** The ledger is not vacuous: several batches, real grades, and receipts that lived through more than one batch. */
function expectRealLedger(snapshot: LedgerSnapshot, report: ReplayReport): void {
  const count = (grade: Grade) => snapshot.receipts.filter((receipt) => receipt.grade === grade).length;
  expect(report.batches).toBeGreaterThanOrEqual(2);
  for (const grade of [
    'VERIFIED',
    'NOT_FOUND',
    'PARTIAL',
    'UNASKED',
    'OVER_SCOPE',
    'UNVERIFIABLE',
  ] as const) {
    expect(count(grade), grade).toBeGreaterThan(0);
  }
  expect(snapshot.receipts.filter((receipt) => receipt.override !== undefined).length).toBeGreaterThan(0);
  expect(snapshot.receipts.filter((receipt) => receipt.observationIds.length > 0).length).toBeGreaterThan(0);
  expect(strayReceipts(snapshot)).toBe(0);
  expect(strayInOwnWindow(snapshot)).toBeGreaterThan(0);
  expect(readAtBatch(snapshot)).toBeGreaterThan(0);
  // Every row, stray ones included, is one project() could return (its source's allowlisted fields, §10 hash).
  const unprojectable = snapshot.observations.filter(
    (observation) => observationIntegrityProblems(observation, DEFAULT_POLICY).length > 0,
  );
  expect(unprojectable).toEqual([]);
  expectFinalisedAcrossBatches(snapshot);
}

/**
 * Receipts finalised along the way: a FINAL claim receipt whose claim was already seen at an earlier batch (so it
 * was PENDING there and regraded later), and a FINAL claim receipt holding evidence before the last batch (so a
 * later batch had it fixed, §4.3).
 */
function expectFinalisedAcrossBatches(snapshot: LedgerSnapshot): void {
  const instants = [...new Set(snapshot.receipts.map((receipt) => Date.parse(receipt.computedAt)))];
  const lastMs = Math.max(...instants);
  const seenMs = new Map(snapshot.claims.map((claim) => [claim.id, Date.parse(claim.observedAt)]));
  const finalClaims = snapshot.receipts.filter(
    (receipt) =>
      receipt.claimId !== undefined && (receipt.override?.previousState ?? receipt.state) === 'FINAL',
  );
  const regraded = finalClaims.filter((receipt) => {
    const observedMs = seenMs.get(receipt.claimId ?? receipt.id) ?? Infinity;
    const computedMs = Date.parse(receipt.computedAt);
    return instants.some((atMs) => atMs >= observedMs && atMs < computedMs);
  });
  expect(regraded.length).toBeGreaterThan(0);
  const heldEarly = finalClaims.filter(
    (receipt) => receipt.observationIds.length > 0 && Date.parse(receipt.computedAt) < lastMs,
  );
  expect(heldEarly.length).toBeGreaterThan(0);
}

describe('replay of a synthetic ledger (task 1.9 Done-when)', () => {
  it('1,000 claims and 10,000 observations graded in several batches: replay reproduces 100%, and one mutated grade is exactly one mismatch', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          seed: fc.integer({ min: 0, max: 0x7fff_ffff }),
          batches: fc.integer({ min: 3, max: 8 }),
          overridesPerGap: fc.integer({ min: 2, max: 8 }),
          pick: fc.nat(),
        }),
        async ({ seed, batches, overridesPerGap, pick }) => {
          const { snapshot } = await simulate({ seed, ...DONE_WHEN, batches, overridesPerGap });
          expect(snapshot.claims).toHaveLength(DONE_WHEN.claims);
          expect(snapshot.observations).toHaveLength(DONE_WHEN.observations);
          const report = await replay(snapshot);
          expectReproduced(report, snapshot);
          expectRealLedger(snapshot, report);

          const target = receiptAt(snapshot, pick);
          const grade = otherGrade(target.grade, pick);
          const mutated = await replay(replaceReceipt(snapshot, target, { ...target, grade }));
          expect(mutated.mismatches).toEqual([
            { receiptId: target.id, field: 'grade', stored: grade, replayed: target.grade },
          ]);
          expect(mutated).toMatchObject({ mismatched: 1, reproduced: snapshot.receipts.length - 1 });
        },
      ),
      { numRuns: 5 },
    );
  }, 600_000);
});

/** qa_tester rule 4: every core property runs at least 1,000 examples. */
const SMALL_RUNS = 1_000;

/** Small ledgers with a stray row in its own source's window, and with a claim read at a batch instant: asserted
 * after the property, so it is never vacuous. */
const tally = { strayLedgers: 0, readAtBatch: 0 };

/** Small ledgers, so 1,000 of them stay cheap: any size from one claim and one observation up. */
const ledgerArb = fc.record({
  seed: fc.integer({ min: 0, max: 0x7fff_ffff }),
  claims: fc.integer({ min: 1, max: 20 }),
  observations: fc.integer({ min: 1, max: 100 }),
  batches: fc.integer({ min: 2, max: 4 }),
  overridesPerGap: fc.integer({ min: 0, max: 3 }),
  pick: fc.nat(),
});

describe('replay of many small synthetic ledgers', () => {
  it('reproduces 100%, and one mutated grade or ruleId is exactly that one mismatch', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async ({ pick, ...options }) => {
        const { snapshot } = await simulate(options);
        expectReproduced(await replay(snapshot), snapshot);
        expect(strayReceipts(snapshot)).toBe(0);
        if (strayInOwnWindow(snapshot) > 0) tally.strayLedgers += 1;
        if (readAtBatch(snapshot) > 0) tally.readAtBatch += 1;
        if (snapshot.receipts.length === 0) return;
        const target = receiptAt(snapshot, pick);
        const grade = otherGrade(target.grade, pick);
        const ruleId = target.ruleId === 'verified' ? 'partial' : 'verified';
        const report = await replay(replaceReceipt(snapshot, target, { ...target, grade, ruleId }));
        expect(report.mismatches).toEqual([
          { receiptId: target.id, field: 'grade', stored: grade, replayed: target.grade },
          { receiptId: target.id, field: 'ruleId', stored: ruleId, replayed: target.ruleId },
        ]);
      }),
      { numRuns: SMALL_RUNS },
    );
    expect(tally.strayLedgers).toBeGreaterThan(SMALL_RUNS / 20);
    expect(tally.readAtBatch).toBeGreaterThan(SMALL_RUNS / 20);
    console.log(`replay property tally: ${JSON.stringify(tally)}`);
  }, 600_000);
});

describe('replay of many small synthetic ledgers, tampered', () => {
  it('a moved inputs row is one inputsHash mismatch; a lost one is one receiptInputs mismatch', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async ({ pick, ...options }) => {
        const { snapshot } = await simulate(options);
        if (snapshot.receipts.length === 0) return;
        const target = receiptAt(snapshot, pick);
        const inputs = snapshot.receiptInputs.get(target.inputsHash);
        if (inputs === undefined) throw new Error('every stored receipt has its inputs');
        const forged = Sha256.parse('e'.repeat(64));
        const moved = new Map(snapshot.receiptInputs).set(forged, inputs);
        const tampered = replaceReceipt(snapshot, target, { ...target, inputsHash: forged });
        const report = await replay({ ...tampered, receiptInputs: moved });
        expect(report.mismatches).toEqual([
          { receiptId: target.id, field: 'inputsHash', stored: forged, replayed: target.inputsHash },
        ]);
        const lost = new Map(snapshot.receiptInputs);
        lost.delete(target.inputsHash);
        expect((await replay({ ...snapshot, receiptInputs: lost })).mismatches).toEqual([
          { receiptId: target.id, field: 'receiptInputs', stored: target.inputsHash, replayed: null },
        ]);
      }),
      { numRuns: SMALL_RUNS },
    );
  }, 600_000);

  it('reports the same thing whatever the order of claims, observations and receipts', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, fc.nat(), async ({ pick, ...options }, shift) => {
        const { snapshot } = await simulate(options);
        if (snapshot.receipts.length === 0) return;
        const target = receiptAt(snapshot, pick);
        const tampered = replaceReceipt(snapshot, target, {
          ...target,
          grade: otherGrade(target.grade, pick),
        });
        const rotate = <T>(items: readonly T[]): T[] => {
          const at = items.length === 0 ? 0 : shift % items.length;
          return [...items.slice(at), ...items.slice(0, at)].reverse();
        };
        const shuffled = {
          ...tampered,
          claims: rotate(tampered.claims),
          observations: rotate(tampered.observations),
          receipts: rotate(tampered.receipts),
        };
        const [a, b] = await Promise.all([replay(tampered), replay(shuffled)]);
        expect(canonicalJson(b)).toBe(canonicalJson(a));
      }),
      { numRuns: SMALL_RUNS },
    );
  }, 600_000);
});
