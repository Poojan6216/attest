/**
 * Task 1.6: each event's payload rules and edges (docs/grading.md §8, §15). Override needs a grade of VERIFIED
 * or NOT_FOUND, a visible reason and a timestamp; override then revert restores the exact prior receipt;
 * regrade replaces only its own subject's PENDING row; supersede touches UNASKED receipts only and keeps the
 * lifecycle reasons last and in table order; a stored receipt that breaks the schema or whose lifecycle reasons
 * disagree with its fields is refused. Every refusal is an IllegalTransitionError whose message carries no
 * user text (Hard Rule 10).
 */
import { describe, expect, it } from 'vitest';

import { Receipt } from '../../../src/core/schema';
import { type IllegalTransitionCode, IllegalTransitionError, transition } from '../../../src/core/state';

const ulid = (n: number): string => String(n).padStart(26, '0');
const HASH = 'ab'.repeat(32);
const T0 = '2026-10-06T14:48:00-04:00';
const T1 = '2026-10-06T15:05:00-04:00';
const C1 = ulid(901);
const C2 = ulid(902);
const REASON = 'I cancelled it myself';

const CLAIM_SUBJECT = {
  id: ulid(1),
  agent: 'muse',
  claimId: ulid(2),
  observationIds: [],
  signals: {},
  policyHash: HASH,
  inputsHash: HASH,
  computedAt: T0,
};
const CLAIM_FINAL = Receipt.parse({
  ...CLAIM_SUBJECT,
  grade: 'NOT_FOUND',
  confidence: 1,
  ruleId: 'not_found',
  reasons: [
    { code: 'coverage.account_unbound', params: { source: 'gmail.sent' } },
    { code: 'match.none', params: {} },
  ],
  state: 'FINAL',
  finalAt: T0,
});
const CLAIM_PENDING = Receipt.parse({
  ...CLAIM_SUBJECT,
  grade: 'UNVERIFIABLE',
  confidence: 0,
  ruleId: 'pending',
  reasons: [
    { code: 'grace.waiting', params: { source: 'gmail.sent' } },
    { code: 'match.none', params: {} },
  ],
  state: 'PENDING',
});
const UNASKED_FINAL = Receipt.parse({
  id: ulid(11),
  agent: 'muse',
  observationIds: [ulid(12)],
  grade: 'UNASKED',
  confidence: 0.7,
  ruleId: 'unasked',
  reasons: [{ code: 'unasked.session', params: { agent: 'muse' } }],
  signals: {},
  state: 'FINAL',
  policyHash: HASH,
  inputsHash: HASH,
  attribution: 'likely',
  computedAt: T0,
  finalAt: T0,
});

const override = (receipt: Receipt, grade: 'VERIFIED' | 'NOT_FOUND' = 'VERIFIED', reason = REASON) =>
  transition(receipt, { event: 'override', grade, reason, at: T1 });
const supersede = (receipt: Receipt, claimId: string) => transition(receipt, { event: 'supersede', claimId });
const revert = (receipt: Receipt) => transition(receipt, { event: 'revert' });
const codes = (receipt: Receipt) => receipt.reasons.map((reason) => reason.code);

/** Assert `fn` throws IllegalTransitionError with `code` (and `from`, when given), and return the error. */
function expectRefusal(
  fn: () => unknown,
  code: IllegalTransitionCode,
  from?: string,
): IllegalTransitionError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IllegalTransitionError);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof IllegalTransitionError)) throw error;
    expect(error.code).toBe(code);
    if (from !== undefined) expect(error.from).toBe(from);
    return error;
  }
  throw new Error(`expected IllegalTransitionError(${code})`);
}

describe('override: payload rules', () => {
  it.each([
    ['an empty reason', ''],
    ['a whitespace-only reason', ' \t\n '],
    ['a zero-width-only reason', '​‌﻿'],
    ['a bidi-mark-only reason', '‮‏'],
    ['a reason over SCHEMA_LIMITS.ITEM', 'x'.repeat(121)],
  ])('refuses %s with invalid_event', (_label, reason) => {
    expectRefusal(() => override(CLAIM_FINAL, 'VERIFIED', reason), 'invalid_event', 'FINAL');
  });

  it('accepts a reason of exactly SCHEMA_LIMITS.ITEM characters with one visible character', () => {
    const reason = `${' '.repeat(119)}x`;
    expect(override(CLAIM_FINAL, 'VERIFIED', reason).override?.reason).toBe(reason);
  });

  it.each([
    ['a timestamp with no offset', '2026-10-06T15:05:00'],
    ['a relative time', 'yesterday'],
    ['an empty timestamp', ''],
  ])('refuses %s as `at`', (_label, at) => {
    expectRefusal(
      () => transition(CLAIM_FINAL, { event: 'override', grade: 'VERIFIED', reason: REASON, at }),
      'invalid_event',
    );
  });

  it.each(['PARTIAL', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE', 'verified'])(
    'refuses override grade %s',
    (grade) => {
      const event = { event: 'override', grade, reason: REASON, at: T1 };
      expectRefusal(() => Reflect.apply(transition, undefined, [CLAIM_FINAL, event]), 'invalid_event');
    },
  );

  it('never puts the override reason in the error message', () => {
    const secret = `card 4111 1111 1111 1111 ${'x'.repeat(120)}`;
    const error = expectRefusal(() => override(CLAIM_FINAL, 'VERIFIED', secret), 'invalid_event');
    expect(error.message).toBe('state: invalid_event (from FINAL)');
    const twice = expectRefusal(
      () => override(override(CLAIM_FINAL), 'VERIFIED', secret),
      'already_overridden',
    );
    expect(twice.message).not.toContain('4111');
  });
});

describe('override then revert: the exact prior receipt', () => {
  it.each([
    ['PENDING claim receipt', CLAIM_PENDING],
    ['FINAL claim receipt', CLAIM_FINAL],
    ['FINAL UNASKED receipt', UNASKED_FINAL],
    ['superseded UNASKED receipt', supersede(UNASKED_FINAL, C1)],
  ])('%s', (_label, receipt) => {
    for (const grade of ['VERIFIED', 'NOT_FOUND'] as const) {
      const result = revert(override(receipt, grade));
      expect(result).toStrictEqual(receipt);
    }
  });

  it('an override sits beside the computed grade and is the last reason (golden 56)', () => {
    const result = override(CLAIM_FINAL);
    expect(result.grade).toBe('NOT_FOUND');
    expect(codes(result)).toEqual(['coverage.account_unbound', 'match.none', 'override.user']);
    expect(result.reasons.at(-1)?.params).toEqual({ grade: 'VERIFIED' });
  });

  it('a reverted receipt can be overridden again, and a FINAL one still never regraded', () => {
    const again = override(revert(override(CLAIM_FINAL, 'VERIFIED')), 'NOT_FOUND');
    expect(again.override?.grade).toBe('NOT_FOUND');
    expectRefusal(() => transition(revert(again), { event: 'regrade', next: CLAIM_FINAL }), 'regrade_final');
  });
});

describe('regrade: only its own PENDING row', () => {
  it('refuses the receipt of another subject', () => {
    const other = Receipt.parse({ ...CLAIM_FINAL, id: ulid(3) });
    expectRefusal(
      () => transition(CLAIM_PENDING, { event: 'regrade', next: other }),
      'subject_mismatch',
      'PENDING',
    );
  });

  it('refuses a next receipt that is USER_OVERRIDDEN: only grade() output is installed', () => {
    const next = override(CLAIM_FINAL);
    expectRefusal(() => transition(CLAIM_PENDING, { event: 'regrade', next }), 'invalid_event', 'PENDING');
  });

  it('refuses a next receipt that breaks the schema or its lifecycle reasons', () => {
    const noFinalAt = { ...CLAIM_PENDING, state: 'FINAL' } as const;
    expectRefusal(() => transition(CLAIM_PENDING, { event: 'regrade', next: noFinalAt }), 'invalid_event');
    const lifecycle = Receipt.parse({
      ...CLAIM_FINAL,
      reasons: [{ code: 'superseded', params: { claimId: C1 } }],
    });
    expectRefusal(() => transition(CLAIM_PENDING, { event: 'regrade', next: lifecycle }), 'invalid_event');
  });

  it('refuses a receipt overridden from PENDING (an overridden receipt is never regraded)', () => {
    const next = Receipt.parse({ ...CLAIM_PENDING, computedAt: T1 });
    expectRefusal(
      () => transition(override(CLAIM_PENDING), { event: 'regrade', next }),
      'regrade_overridden',
    );
  });
});

describe('supersede: UNASKED only, lifecycle reasons last', () => {
  it('refuses a claimId that is not an uppercase ULID', () => {
    for (const claimId of ['not-a-ulid', `${C1.slice(0, -1)}a`, '']) {
      expectRefusal(() => supersede(UNASKED_FINAL, claimId), 'invalid_event', 'FINAL');
    }
  });

  it('is idempotent for the same claim and replaces the claim for another', () => {
    const once = supersede(UNASKED_FINAL, C1);
    expect(supersede(once, C1)).toStrictEqual(once);
    const replaced = supersede(once, C2);
    expect(replaced.supersededBy).toBe(C2);
    expect(replaced.reasons.filter((reason) => reason.code === 'superseded')).toEqual([
      { code: 'superseded', params: { claimId: C2 } },
    ]);
  });

  it('keeps override.user before superseded whichever event came first, and revert keeps superseded', () => {
    const overrideFirst = supersede(override(UNASKED_FINAL, 'NOT_FOUND'), C1);
    const supersedeFirst = override(supersede(UNASKED_FINAL, C1), 'NOT_FOUND');
    expect(overrideFirst).toStrictEqual(supersedeFirst);
    expect(codes(overrideFirst)).toEqual(['unasked.session', 'override.user', 'superseded']);
    const reverted = revert(overrideFirst);
    expect(reverted).toStrictEqual(supersede(UNASKED_FINAL, C1));
    expect(codes(reverted)).toEqual(['unasked.session', 'superseded']);
  });

  it('refuses every non-UNASKED grade, whatever the state', () => {
    for (const grade of ['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'OVER_SCOPE', 'UNVERIFIABLE'] as const) {
      const receipt = Receipt.parse({ ...CLAIM_FINAL, grade });
      expectRefusal(() => supersede(receipt, C1), 'not_unasked', 'FINAL');
      expectRefusal(() => supersede(override(receipt), C1), 'not_unasked', 'USER_OVERRIDDEN');
    }
  });
});

describe('stored receipts the machine refuses', () => {
  const overrideUser = { code: 'override.user', params: { grade: 'VERIFIED' } } as const;
  const superseded = { code: 'superseded', params: { claimId: C1 } } as const;
  const overriddenFinal = override(CLAIM_FINAL);

  it.each([
    ['a PENDING receipt with finalAt', { ...CLAIM_PENDING, finalAt: CLAIM_FINAL.computedAt }],
    ['an UNASKED receipt with a claimId', { ...UNASKED_FINAL, claimId: CLAIM_FINAL.id }],
    ['override.user with no override', { ...CLAIM_FINAL, reasons: [...CLAIM_FINAL.reasons, overrideUser] }],
    [
      'superseded with no supersededBy',
      { ...UNASKED_FINAL, reasons: [...UNASKED_FINAL.reasons, superseded] },
    ],
    ['an override with no override.user reason', { ...overriddenFinal, reasons: CLAIM_FINAL.reasons }],
    [
      'override.user naming another grade',
      { ...override(CLAIM_FINAL, 'NOT_FOUND'), reasons: overriddenFinal.reasons },
    ],
    [
      'override.user before a graded reason',
      { ...overriddenFinal, reasons: [overrideUser, ...CLAIM_FINAL.reasons] },
    ],
  ])('%s: invalid_receipt, with no state', (_label, receipt) => {
    for (const event of [{ event: 'revert' }, { event: 'supersede', claimId: C1 }] as const) {
      const error = expectRefusal(() => transition(receipt, event), 'invalid_receipt');
      expect(error.from).toBeUndefined();
      expect(error.message).toBe('state: invalid_receipt');
    }
  });

  it('superseded before override.user is out of §15 order', () => {
    const both = supersede(override(UNASKED_FINAL), C1);
    const swapped = { ...both, reasons: [...UNASKED_FINAL.reasons, superseded, overrideUser] };
    expectRefusal(() => revert(swapped), 'invalid_receipt');
  });

  it('a legal event whose result exceeds the reason cap: invalid_result, nothing stored', () => {
    const full = Receipt.parse({
      ...CLAIM_FINAL,
      reasons: Array.from({ length: 32 }, () => CLAIM_FINAL.reasons[1]),
    });
    expectRefusal(() => override(full), 'invalid_result', 'FINAL');
  });

  it('an event kind outside the union: invalid_event', () => {
    for (const event of [{ event: 'delete' }, { event: 'finalize' }, {}]) {
      expectRefusal(
        () => Reflect.apply(transition, undefined, [CLAIM_PENDING, event]),
        'invalid_event',
        'PENDING',
      );
    }
  });
});
