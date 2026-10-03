/**
 * `revert` keeps what batches saw (docs/grading.md §8, §9; Hard Rule 4): override then revert restores the prior
 * receipt and appends the override to `reverted` with the revert's instant and the computed part it sat beside, never
 * its reason; every later event keeps that list; a regrade computed while a reverted override was still in force is
 * refused (`regrade_held`: a claim up to its revert, an orphan from the override's `at` up to its revert); an
 * override is never stamped before the last revert; the list is capped by the schema (`invalid_result`).
 */
import { describe, expect, it } from 'vitest';

import { Receipt, SCHEMA_LIMITS } from '../../../src/core/schema';
import { type IllegalTransitionCode, IllegalTransitionError, transition } from '../../../src/core/state';

const ulid = (n: number): string => String(n).padStart(26, '0');
const HASH = 'ab'.repeat(32);
const T0 = '2026-10-06T14:48:00-04:00';
const T1 = '2026-10-06T15:05:00-04:00';
const T2 = '2026-10-06T16:00:00-04:00';
const T3 = '2026-10-06T17:00:00-04:00';
const REASON = 'I cancelled it myself';

const CLAIM_PENDING = Receipt.parse({
  id: ulid(1),
  agent: 'muse',
  claimId: ulid(2),
  observationIds: [ulid(3)],
  grade: 'VERIFIED',
  confidence: 1,
  ruleId: 'verified',
  reasons: [{ code: 'match.best', params: { observationId: ulid(3) } }],
  signals: { score: 1 },
  state: 'PENDING',
  policyHash: HASH,
  inputsHash: HASH,
  computedAt: T0,
});
const CLAIM_FINAL = Receipt.parse({ ...CLAIM_PENDING, state: 'FINAL', finalAt: T0 });
const UNASKED_PENDING = Receipt.parse({
  id: ulid(11),
  agent: 'muse',
  observationIds: [ulid(12)],
  grade: 'UNASKED',
  confidence: 0.7,
  ruleId: 'unasked',
  reasons: [{ code: 'unasked.session', params: { agent: 'muse' } }],
  signals: {},
  state: 'PENDING',
  policyHash: HASH,
  inputsHash: HASH,
  attribution: 'likely',
  computedAt: T0,
});
const UNASKED_FINAL = Receipt.parse({ ...UNASKED_PENDING, state: 'FINAL', finalAt: T0 });

const override = (receipt: Receipt, grade: 'VERIFIED' | 'NOT_FOUND' = 'VERIFIED', at = T1) =>
  transition(receipt, { event: 'override', grade, reason: REASON, at });
const revert = (receipt: Receipt, at = T2) => transition(receipt, { event: 'revert', at });
/** grade()'s receipt for a PENDING `receipt`'s subject, computed again at `computedAt`. */
const gradedAt = (receipt: Receipt, computedAt: string) =>
  Receipt.parse({ ...receipt, computedAt, inputsHash: 'cd'.repeat(32) });

function expectRefusal(fn: () => unknown, code: IllegalTransitionCode): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(IllegalTransitionError);
  expect(thrown).toMatchObject({ code });
}

describe('override then revert: the prior receipt, the override kept as reverted (§8)', () => {
  it.each([
    ['PENDING claim receipt', CLAIM_PENDING],
    ['FINAL claim receipt', CLAIM_FINAL],
    ['PENDING UNASKED receipt', UNASKED_PENDING],
    ['FINAL UNASKED receipt', UNASKED_FINAL],
    ['superseded UNASKED receipt', transition(UNASKED_FINAL, { event: 'supersede', claimId: ulid(901) })],
  ])('%s', (_label, receipt) => {
    for (const grade of ['VERIFIED', 'NOT_FOUND'] as const) {
      const result = revert(override(receipt, grade));
      const { reverted, ...rest } = result;
      expect(rest).toStrictEqual(receipt);
      expect(reverted).toStrictEqual([
        {
          grade,
          at: T1,
          revertedAt: T2,
          previousState: receipt.state,
          computedAt: receipt.computedAt,
          observationIds: receipt.observationIds,
        },
      ]);
      expect(Receipt.parse(result)).toStrictEqual(result);
      expect(JSON.stringify(result)).not.toContain(REASON);
    }
  });

  it('appends each revert in order, and keeps the list through override, supersede and regrade', () => {
    const twice = revert(override(revert(override(UNASKED_PENDING), T2), 'NOT_FOUND', T2), T3);
    expect(twice.reverted?.map((entry) => [entry.grade, entry.at, entry.revertedAt])).toEqual([
      ['VERIFIED', T1, T2],
      ['NOT_FOUND', T2, T3],
    ]);
    expect(override(twice, 'VERIFIED', T3).reverted).toStrictEqual(twice.reverted);
    expect(transition(twice, { event: 'supersede', claimId: ulid(902) }).reverted).toStrictEqual(
      twice.reverted,
    );
    const later = gradedAt(UNASKED_PENDING, '2026-10-06T18:00:00-04:00');
    const regraded = transition(twice, { event: 'regrade', next: later });
    expect(regraded).toStrictEqual({ ...later, reverted: twice.reverted });
  });

  it('a FINAL receipt reverted is still never regraded', () => {
    const again = override(revert(override(CLAIM_FINAL)), 'NOT_FOUND', T2);
    expect(again.override?.grade).toBe('NOT_FOUND');
    expectRefusal(
      () => transition(revert(again, T3), { event: 'regrade', next: CLAIM_FINAL }),
      'regrade_final',
    );
  });
});

describe('revert and override instants (§8)', () => {
  it('refuses a revert before the override, or with an instant that is not a timestamp', () => {
    const overridden = override(CLAIM_FINAL);
    expectRefusal(() => revert(overridden, '2026-10-06T15:04:59-04:00'), 'invalid_event');
    for (const at of ['', 'yesterday', '2026-10-06T16:00:00']) {
      expectRefusal(() => revert(overridden, at), 'invalid_event');
    }
    expectRefusal(
      () => Reflect.apply(transition, undefined, [overridden, { event: 'revert' }]),
      'invalid_event',
    );
    // The same instant as the override, written in another offset: accepted (instants, not strings).
    expect(revert(overridden, '2026-10-06T19:05:00Z').reverted?.[0]?.revertedAt).toBe('2026-10-06T19:05:00Z');
  });

  it('refuses an override stamped before the last revert, and accepts one at it', () => {
    const reverted = revert(override(CLAIM_FINAL), T2);
    expectRefusal(() => override(reverted, 'NOT_FOUND', '2026-10-06T15:59:59.999-04:00'), 'invalid_event');
    expect(override(reverted, 'NOT_FOUND', T2).override?.at).toBe(T2);
  });

  it('refuses a regrade whose next already holds reverted overrides (grade() never writes one)', () => {
    const next = { ...gradedAt(CLAIM_PENDING, T3), reverted: revert(override(CLAIM_PENDING)).reverted };
    expectRefusal(
      () => transition(CLAIM_PENDING, { event: 'regrade', next: Receipt.parse(next) }),
      'invalid_event',
    );
  });
});

describe('regrade while a reverted override was still in force: regrade_held (§8)', () => {
  it('a claim: refused by every batch up to its revert, accepted after it', () => {
    const reverted = revert(override(CLAIM_PENDING), T2);
    for (const at of [T0, T1, '2026-10-06T15:30:00-04:00', T2, '2026-10-06T20:00:00Z']) {
      expectRefusal(
        () => transition(reverted, { event: 'regrade', next: gradedAt(CLAIM_PENDING, at) }),
        'regrade_held',
      );
    }
    const after = gradedAt(CLAIM_PENDING, '2026-10-06T16:00:00.001-04:00');
    expect(transition(reverted, { event: 'regrade', next: after }).computedAt).toBe(after.computedAt);
  });

  it('an orphan: refused while the override took it, from its `at` to its revert; accepted before and after', () => {
    const reverted = revert(override(UNASKED_PENDING), T2);
    for (const at of ['2026-10-06T15:05:00.001-04:00', T2]) {
      expectRefusal(
        () => transition(reverted, { event: 'regrade', next: gradedAt(UNASKED_PENDING, at) }),
        'regrade_held',
      );
    }
    // A batch evaluated at or before the override's `at` that read the revert: the orphan was never taken there.
    for (const at of [T0, T1, '2026-10-06T16:00:00.001-04:00']) {
      expect(transition(reverted, { event: 'regrade', next: gradedAt(UNASKED_PENDING, at) }).computedAt).toBe(
        at,
      );
    }
  });
});

describe('the reverted list is capped (SCHEMA_LIMITS.REASONS)', () => {
  it('keeps up to the cap and refuses one more with invalid_result, changing nothing', () => {
    let receipt = CLAIM_FINAL;
    const minute = (n: number) => new Date(Date.parse(T1) + n * 60_000).toISOString();
    for (let n = 0; n < SCHEMA_LIMITS.REASONS; n += 1) {
      receipt = revert(override(receipt, 'NOT_FOUND', minute(2 * n)), minute(2 * n + 1));
    }
    expect(receipt.reverted).toHaveLength(SCHEMA_LIMITS.REASONS);
    const full = override(receipt, 'NOT_FOUND', minute(2 * SCHEMA_LIMITS.REASONS));
    const before = JSON.stringify(full);
    expectRefusal(() => revert(full, minute(2 * SCHEMA_LIMITS.REASONS + 1)), 'invalid_result');
    expect(JSON.stringify(full)).toBe(before);
  });
});
