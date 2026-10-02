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
 *  - smaller ledgers, many more of them: the same for grade and ruleId, an inputsHash mismatch when one receipt's
 *    inputs row moves, a receiptInputs mismatch when one row is lost, and the same report whatever the input order.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../../src/core/hash';
import { type LedgerSnapshot, replay, type ReplayReport } from '../../src/core/replay';
import { Grade, type Receipt, Sha256 } from '../../src/core/schema';
import { simulate } from '../tools/attest-ledger';

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

/** Small ledgers: any size from one claim and one observation up. */
const ledgerArb = fc.record({
  seed: fc.integer({ min: 0, max: 0x7fff_ffff }),
  claims: fc.integer({ min: 1, max: 60 }),
  observations: fc.integer({ min: 1, max: 500 }),
  batches: fc.integer({ min: 2, max: 7 }),
  overridesPerGap: fc.integer({ min: 0, max: 5 }),
  pick: fc.nat(),
});

describe('replay of many small synthetic ledgers', () => {
  it('reproduces 100%, and one mutated grade or ruleId is exactly that one mismatch', async () => {
    await fc.assert(
      fc.asyncProperty(ledgerArb, async ({ pick, ...options }) => {
        const { snapshot } = await simulate(options);
        expectReproduced(await replay(snapshot), snapshot);
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
      { numRuns: 60 },
    );
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
      { numRuns: 40 },
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
      { numRuns: 30 },
    );
  }, 600_000);
});
