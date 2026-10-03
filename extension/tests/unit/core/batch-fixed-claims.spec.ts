/**
 * The claim pre-assignments of reverted overrides (src/core/batch-fixed-claims.ts; docs/grading.md §4.3, §8): each
 * claim's spells, and the sweep that keeps them one-to-one. Hand-built receipts, so each rule is pinned on its own:
 *  - FINAL evidence released by a reverted override to NOT_FOUND is fixed again after the revert, unless another
 *    claim holds it then (that claim's spell began inside the release): then it stays released for good;
 *  - at one instant a grading wins over a revert, and between two reverts the lower claim id wins;
 *  - an override from PENDING to VERIFIED fixes its evidence from the later of its grading and the revert before it
 *    since that grading, up to its own revert;
 *  - each observation of a receipt is decided on its own; what one claim fixes never reaches another claim.
 */
import { describe, expect, it } from 'vitest';

import { type BatchFixed, fixedInForce, preAssignments } from '../../../src/core/batch-fixed';
import { IsoTs, Receipt, Ulid } from '../../../src/core/schema';

const ulid = (n: number): Ulid => Ulid.parse(String(n).padStart(26, '0'));
const HASH = 'ab'.repeat(32);
const at = (hour: number): IsoTs => IsoTs.parse(`2026-10-06T${String(hour).padStart(2, '0')}:00:00Z`);
const [O1, O2] = [ulid(901), ulid(902)];
const OVERRIDE = { reason: 'user', grade: 'NOT_FOUND' } as const;

type Entry = Readonly<{ grade?: string; at: IsoTs; revertedAt: IsoTs; previousState: 'PENDING' | 'FINAL' }>;

/** Claim `n`'s receipt holding `observationIds`, graded at `computedAt`, with reverted `entries` and `fields`. */
function claimReceipt(
  n: number,
  state: 'PENDING' | 'FINAL',
  computedAt: IsoTs,
  observationIds: readonly Ulid[],
  entries: readonly Entry[] = [],
  fields: Record<string, unknown> = {},
): Receipt {
  const reverted = entries.map((entry) => ({ grade: 'NOT_FOUND', computedAt, observationIds, ...entry }));
  return Receipt.parse({
    id: ulid(100 + n),
    agent: 'muse',
    claimId: ulid(n),
    observationIds,
    grade: 'VERIFIED',
    confidence: 1,
    ruleId: 'verified',
    reasons: [],
    signals: {},
    state,
    policyHash: HASH,
    inputsHash: HASH,
    computedAt,
    ...(state === 'FINAL' ? { finalAt: computedAt } : {}),
    ...(reverted.length > 0 ? { reverted } : {}),
    ...fields,
  });
}

/** Overridden `receipt` (from its state) at `when`, with the lifecycle reason the schema requires. */
const overridden = (receipt: Receipt, grade: 'VERIFIED' | 'NOT_FOUND', when: IsoTs): Receipt =>
  Receipt.parse({
    ...receipt,
    state: 'USER_OVERRIDDEN',
    override: { ...OVERRIDE, grade, at: when, previousState: receipt.state },
    reasons: [...receipt.reasons, { code: 'override.user', params: { grade } }],
  });

const pairsOf = (fixed: readonly BatchFixed[], claim: number) =>
  fixed.filter((pair) => pair.claimId === ulid(claim));

/** Who holds `observation` in a batch at `hour`: the claim numbers of the pairs in force (one-to-one: at most one). */
const holders = (fixed: readonly BatchFixed[], observation: Ulid, hour: number) =>
  fixedInForce(fixed, Date.parse(at(hour)))
    .fixed.filter((pair) => pair.observationId === observation)
    .map((pair) => Number(pair.claimId));

/** Claim 1, FINAL at 1 holding O1, overridden to NOT_FOUND at 2 and reverted at `revertedAt`. */
const released = (revertedAt: IsoTs) =>
  claimReceipt(1, 'FINAL', at(1), [O1], [{ at: at(2), revertedAt, previousState: 'FINAL' }]);

describe('FINAL evidence released and reverted', () => {
  it('is fixed again after the revert when no other claim held it meanwhile', () => {
    const fixed = preAssignments([released(at(4))]);
    expect(pairsOf(fixed, 1)).toEqual([
      { observationId: O1, claimId: ulid(1), after: at(1), released: [{ from: at(2), to: at(4) }] },
    ]);
    expect([2, 3, 4, 5, 9].map((hour) => holders(fixed, O1, hour))).toEqual([[1], [], [], [1], [1]]);
  });

  it('stays released for good when another claim began to hold it inside the release, FINAL or overridden from PENDING', () => {
    for (const other of [
      claimReceipt(2, 'FINAL', at(3), [O1]),
      overridden(claimReceipt(2, 'PENDING', at(3), [O1]), 'VERIFIED', at(3)),
    ]) {
      const fixed = preAssignments([released(at(5)), other]);
      expect(pairsOf(fixed, 1)).toEqual([
        { observationId: O1, claimId: ulid(1), after: at(1), released: [{ from: at(2) }] },
      ]);
      expect([2, 4, 6, 9].map((hour) => holders(fixed, O1, hour))).toEqual([[1], [2], [2], [2]]);
    }
  });

  it('is fixed again when the other claim had let it go before the revert', () => {
    const other = overridden(claimReceipt(2, 'FINAL', at(3), [O1]), 'NOT_FOUND', at(4));
    const fixed = preAssignments([released(at(5)), other]);
    expect([4, 5, 6].map((hour) => holders(fixed, O1, hour))).toEqual([[2], [], [1]]);
  });

  it('is fixed again when the other claim let it go at the revert’s very instant (in force on both sides of it)', () => {
    const other = overridden(claimReceipt(2, 'FINAL', at(3), [O1]), 'NOT_FOUND', at(5));
    const fixed = preAssignments([released(at(5)), other]);
    expect([4, 5, 6].map((hour) => holders(fixed, O1, hour))).toEqual([[2], [2], [1]]);
  });
});

describe('FINAL evidence released and reverted: ties, corrupt ledgers, other overrides', () => {
  it('at one instant, a grading wins over a revert; between two reverts, the lower claim id', () => {
    const tie = preAssignments([released(at(3)), claimReceipt(2, 'FINAL', at(3), [O1])]);
    expect(holders(tie, O1, 4)).toEqual([2]);
    // Claim 2 took O1 FINAL at 3, inside claim 1's release, and released it at 4; both revert at 5.
    const first = claimReceipt(
      1,
      'FINAL',
      at(1),
      [O1],
      [{ at: at(2), revertedAt: at(5), previousState: 'FINAL' }],
    );
    const second = claimReceipt(
      2,
      'FINAL',
      at(3),
      [O1],
      [{ at: at(4), revertedAt: at(5), previousState: 'FINAL' }],
    );
    for (const order of [
      [first, second],
      [second, first],
    ]) {
      expect([2, 3, 4, 5, 6].map((hour) => holders(preAssignments(order), O1, hour))).toEqual([
        [1],
        [],
        [2],
        [],
        [1],
      ]);
    }
  });

  it('never drops a spell that begins at a grading: two that overlap are a corrupt ledger, left for assign to refuse', () => {
    const corrupt = preAssignments([
      claimReceipt(1, 'FINAL', at(1), [O1]),
      claimReceipt(2, 'FINAL', at(2), [O1]),
    ]);
    expect(holders(corrupt, O1, 3)).toEqual([1, 2]);
  });
});

describe('FINAL evidence under other overrides, and per observation', () => {
  it('an override to VERIFIED from FINAL, reverted, released nothing: the evidence stays fixed throughout', () => {
    const kept = claimReceipt(
      1,
      'FINAL',
      at(1),
      [O1],
      [{ grade: 'VERIFIED', at: at(2), revertedAt: at(4), previousState: 'FINAL' }],
    );
    const fixed = preAssignments([kept]);
    expect(pairsOf(fixed, 1)).toEqual([{ observationId: O1, claimId: ulid(1), after: at(1) }]);
    expect([2, 3, 4, 5].map((hour) => holders(fixed, O1, hour))).toEqual([[1], [1], [1], [1]]);
  });

  it('decides each observation of a receipt on its own', () => {
    const both = claimReceipt(
      1,
      'FINAL',
      at(1),
      [O1, O2],
      [{ at: at(2), revertedAt: at(5), previousState: 'FINAL' }],
    );
    const fixed = preAssignments([both, claimReceipt(2, 'FINAL', at(3), [O1])]);
    expect([holders(fixed, O1, 6), holders(fixed, O2, 6)]).toEqual([[2], [1]]);
  });
});

describe('evidence of an override from PENDING to VERIFIED, reverted', () => {
  it('is fixed from its grading up to its revert', () => {
    const receipt = claimReceipt(
      1,
      'PENDING',
      at(1),
      [O1],
      [{ grade: 'VERIFIED', at: at(2), revertedAt: at(4), previousState: 'PENDING' }],
    );
    const fixed = preAssignments([receipt]);
    expect(pairsOf(fixed, 1)).toEqual([{ observationId: O1, claimId: ulid(1), after: at(1), until: at(4) }]);
    expect([1, 2, 4, 5].map((hour) => holders(fixed, O1, hour))).toEqual([[], [1], [1], []]);
  });

  it('from the revert before it since the same grading (an override to NOT_FOUND held the claim, fixing nothing)', () => {
    const entries = [{ at: at(2), revertedAt: at(3), previousState: 'PENDING' }] as const;
    const current = overridden(claimReceipt(1, 'PENDING', at(1), [O1], entries), 'VERIFIED', at(3));
    const fixed = preAssignments([current]);
    expect(pairsOf(fixed, 1)).toEqual([
      { observationId: O1, claimId: ulid(1), after: at(1), released: [{ from: at(1), to: at(3) }] },
    ]);
    expect([2, 3, 4].map((hour) => holders(fixed, O1, hour))).toEqual([[], [], [1]]);
    // Another claim took O1 FINAL while it was free (at 2): the override fixes nothing, and its claim stays named.
    const withOther = preAssignments([current, claimReceipt(2, 'FINAL', at(2), [O1])]);
    expect(pairsOf(withOther, 1)).toEqual([
      { observationId: O1, claimId: ulid(1), after: at(1), released: [{ from: at(1) }] },
    ]);
    expect(holders(withOther, O1, 4)).toEqual([2]);
  });

  it('a reverted span another claim held is left out (it has ended), and the spans after it start at their revert', () => {
    const entries = [
      { grade: 'NOT_FOUND', at: at(2), revertedAt: at(3), previousState: 'PENDING' },
      { grade: 'VERIFIED', at: at(3), revertedAt: at(5), previousState: 'PENDING' },
    ] as const;
    const receipt = claimReceipt(1, 'PENDING', at(1), [O1], entries, { computedAt: at(6) });
    // Regraded at 6 (after its last revert): its stored evidence then is O1 again, but its spans keep their own.
    expect(pairsOf(preAssignments([receipt]), 1)).toEqual([
      {
        observationId: O1,
        claimId: ulid(1),
        after: at(1),
        until: at(5),
        released: [{ from: at(1), to: at(3) }],
      },
    ]);
    expect(pairsOf(preAssignments([receipt, claimReceipt(2, 'FINAL', at(2), [O1])]), 1)).toEqual([]);
  });
});
