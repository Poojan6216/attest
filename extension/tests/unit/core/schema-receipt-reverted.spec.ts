/**
 * The Receipt's `reverted` overrides and their invariants (src/core/schema-receipt.ts; docs/grading.md §8): each
 * entry is a strict object (grade, at, revertedAt, previousState, computedAt, observationIds; never a reason),
 * stamped in order (computedAt ≤ at ≤ revertedAt, each after the one before, the override in force after the last),
 * and consistent with the receipt it sits on: the same computed part until a regrade, regraded only from PENDING and
 * only once the override no longer held (a claim after its revert; an orphan outside `(at, revertedAt]`), and a
 * claim-less receipt's evidence never changes. At least five valid cases (each parses to exactly itself) and five
 * invalid ones, each rejected at one specific path (an entry's index is written as a string by the invariants).
 */
import { describe, expect, it } from 'vitest';

import { Receipt } from '../../../src/core/schema';

const ULID = '01JA0000000000000000000001';
const ULID_B = '01JA0000000000000000000002';
const ULID_C = '01JA0000000000000000000003';
const HASH = 'ab'.repeat(32);
const T0 = '2026-10-06T14:00:00-04:00';
const T1 = '2026-10-06T15:00:00-04:00';
const T2 = '2026-10-06T16:00:00-04:00';
const T3 = '2026-10-06T17:00:00-04:00';
const T4 = '2026-10-06T18:00:00-04:00';

const CLAIM = {
  id: ULID_B,
  agent: 'muse',
  claimId: ULID,
  observationIds: [ULID_C],
  grade: 'VERIFIED',
  confidence: 1,
  ruleId: 'verified',
  reasons: [{ code: 'match.best', params: { observationId: ULID_C } }],
  signals: { score: 1 },
  state: 'PENDING',
  policyHash: HASH,
  inputsHash: HASH,
  computedAt: T0,
};
const FINAL = { ...CLAIM, state: 'FINAL', finalAt: T0 };
const UNASKED = {
  ...Object.fromEntries(Object.entries(CLAIM).filter(([key]) => key !== 'claimId')),
  grade: 'UNASKED',
  ruleId: 'unasked',
  attribution: 'likely',
  reasons: [{ code: 'unasked.session', params: { agent: 'muse' } }],
};
/** An override from `previousState`, at T1, reverted at T2, beside the computed part graded at T0. */
const entry = (previousState: 'PENDING' | 'FINAL', fields: Record<string, unknown> = {}) => ({
  grade: 'VERIFIED',
  at: T1,
  revertedAt: T2,
  previousState,
  computedAt: T0,
  observationIds: [ULID_C],
  ...fields,
});
const OVERRIDE_USER = { code: 'override.user', params: { grade: 'NOT_FOUND' } };
const overridden = (receipt: Record<string, unknown>, at: string, previousState: 'PENDING' | 'FINAL') => ({
  ...receipt,
  state: 'USER_OVERRIDDEN',
  override: { grade: 'NOT_FOUND', reason: 'not me', at, previousState },
  reasons: [...CLAIM.reasons, OVERRIDE_USER],
});

const VALID: readonly (readonly [string, unknown])[] = [
  ['a PENDING claim, reverted, not yet regraded', { ...CLAIM, reverted: [entry('PENDING')] }],
  ['a FINAL claim, reverted', { ...FINAL, reverted: [entry('FINAL')] }],
  ['a claim regraded after its revert', { ...CLAIM, computedAt: T3, reverted: [entry('PENDING')] }],
  [
    'two reverts, then an override at the last revert',
    overridden(
      { ...FINAL, reverted: [entry('FINAL'), entry('FINAL', { at: T2, revertedAt: T3 })] },
      T3,
      'FINAL',
    ),
  ],
  [
    'an UNASKED receipt regraded at or before the override it read reverted',
    { ...UNASKED, computedAt: T1, reverted: [entry('PENDING')] },
  ],
  [
    'an UNASKED receipt regraded after the revert',
    { ...UNASKED, computedAt: T4, reverted: [entry('PENDING')] },
  ],
  [
    'an UNASKED receipt regraded at or before the next override, which the revert before it no longer held',
    {
      ...UNASKED,
      computedAt: T4,
      reverted: [
        entry('PENDING', { at: T2, revertedAt: T3 }),
        entry('PENDING', { computedAt: T1, at: T3, revertedAt: T3 }),
      ],
    },
  ],
  [
    'a revert at the override’s own instant, in another offset',
    { ...FINAL, reverted: [entry('FINAL', { revertedAt: '2026-10-06T19:00:00Z' })] },
  ],
];

const INVALID: readonly (readonly [string, unknown, readonly (string | number)[]])[] = [
  [
    'an override before the grading it sat beside',
    { ...FINAL, reverted: [entry('FINAL', { at: '2026-10-06T13:59:59-04:00' })] },
    ['reverted', '0', 'at'],
  ],
  [
    'a revert before its override',
    { ...FINAL, reverted: [entry('FINAL', { revertedAt: '2026-10-06T14:59:59-04:00' })] },
    ['reverted', '0', 'revertedAt'],
  ],
  [
    'an override before the revert before it',
    {
      ...FINAL,
      reverted: [entry('FINAL'), entry('FINAL', { at: '2026-10-06T15:59:59-04:00', revertedAt: T3 })],
    },
    ['reverted', '1', 'at'],
  ],
  [
    'a grading after the receipt’s own',
    { ...CLAIM, reverted: [entry('PENDING', { computedAt: T1 })] },
    ['reverted', '0', 'computedAt'],
  ],
  [
    'another state while the grading is the same',
    { ...CLAIM, reverted: [entry('FINAL')] },
    ['reverted', '0', 'previousState'],
  ],
  [
    'other evidence while the grading is the same',
    { ...FINAL, reverted: [entry('FINAL', { observationIds: [] })] },
    ['reverted', '0', 'observationIds'],
  ],
  [
    'a FINAL receipt regraded',
    { ...FINAL, computedAt: T3, finalAt: T3, reverted: [entry('FINAL')] },
    ['reverted', '0', 'previousState'],
  ],
  [
    'a claim regraded before its revert',
    { ...CLAIM, computedAt: T2, reverted: [entry('PENDING')] },
    ['computedAt'],
  ],
  [
    'an orphan regraded while its override took it',
    { ...UNASKED, computedAt: T2, reverted: [entry('PENDING')] },
    ['computedAt'],
  ],
  [
    'an orphan whose evidence changed',
    { ...UNASKED, computedAt: T3, reverted: [entry('PENDING', { observationIds: [ULID] })] },
    ['reverted', '0', 'observationIds'],
  ],
  [
    'a claim regraded while the override before was in force',
    {
      ...CLAIM,
      computedAt: T4,
      reverted: [
        entry('PENDING', { revertedAt: T3 }),
        entry('PENDING', { computedAt: T2, at: T3, revertedAt: T3 }),
      ],
    },
    ['reverted', '1', 'computedAt'],
  ],
  [
    'a claim regraded at any instant the override before held it, its `at` or not',
    {
      ...CLAIM,
      computedAt: T4,
      reverted: [
        entry('PENDING', { at: T2, revertedAt: T3 }),
        entry('PENDING', { computedAt: T1, at: T3, revertedAt: T3 }),
      ],
    },
    ['reverted', '1', 'computedAt'],
  ],
  [
    'an orphan regraded while the override before took it',
    {
      ...UNASKED,
      computedAt: T4,
      reverted: [
        entry('PENDING', { revertedAt: T3 }),
        entry('PENDING', { computedAt: T2, at: T3, revertedAt: T3 }),
      ],
    },
    ['reverted', '1', 'computedAt'],
  ],
  [
    'a grading before the one recorded before it',
    {
      ...CLAIM,
      computedAt: T4,
      reverted: [
        entry('PENDING', { computedAt: T1 }),
        entry('PENDING', { computedAt: T0, at: T2, revertedAt: T3 }),
      ],
    },
    ['reverted', '1', 'computedAt'],
  ],
  [
    'an override in force before the last revert',
    overridden({ ...FINAL, reverted: [entry('FINAL')] }, '2026-10-06T15:30:00-04:00', 'FINAL'),
    ['override', 'at'],
  ],
  ['an empty list (absent, not empty)', { ...FINAL, reverted: [] }, ['reverted']],
  [
    'a reverted override that keeps its reason',
    { ...FINAL, reverted: [{ ...entry('FINAL'), reason: 'not me' }] },
    ['reverted', 0],
  ],
  [
    'an override grade that is not one',
    { ...FINAL, reverted: [entry('FINAL', { grade: 'PARTIAL' })] },
    ['reverted', 0, 'grade'],
  ],
];

function issuePaths(value: unknown): (string | number)[][] {
  const result = Receipt.safeParse(value);
  if (result.success) return [];
  const paths = result.error.issues.map((issue) =>
    issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
  );
  return [...new Map(paths.map((path) => [JSON.stringify(path), path])).values()];
}

describe('Receipt.reverted (§8)', () => {
  it('has at least five valid and five invalid cases', () => {
    expect(VALID.length).toBeGreaterThanOrEqual(5);
    expect(INVALID.length).toBeGreaterThanOrEqual(5);
  });

  it.each(VALID.map(([label, value]) => ({ label, value })))(
    'parses $label to exactly itself',
    ({ value }) => {
      expect(Receipt.parse(value)).toEqual(value);
    },
  );

  it.each(INVALID.map(([label, value, path]) => ({ label, value, path })))(
    'rejects $label at $path',
    ({ value, path }) => {
      expect(issuePaths(value)).toEqual([path]);
    },
  );

  it('caps the list at SCHEMA_LIMITS.REASONS entries', () => {
    const at = (n: number) => new Date(Date.parse(T1) + n * 60_000).toISOString();
    const entries = (count: number) =>
      Array.from({ length: count }, (_, n) => entry('FINAL', { at: at(2 * n), revertedAt: at(2 * n + 1) }));
    expect(Receipt.safeParse({ ...FINAL, reverted: entries(32) }).success).toBe(true);
    expect(issuePaths({ ...FINAL, reverted: entries(33) })).toEqual([['reverted']]);
  });
});
