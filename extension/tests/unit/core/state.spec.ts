/**
 * Task 1.6 Done-when, part one: the state table over EVERY (state, event) pair (docs/grading.md §8), for a claim
 * receipt and an UNASKED receipt. Each legal pair lands in the state the table names and keeps the receipt
 * invariants; each illegal pair throws IllegalTransitionError with the code the table names and changes
 * nothing. The table is typed over ReceiptState × ReceiptEventKind, so a new state or event that the table
 * does not cover fails to compile, and a runtime check counts the rows against the schema enums.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { type Reason, Receipt, ReceiptState } from '../../../src/core/schema';
import {
  type IllegalTransitionCode,
  IllegalTransitionError,
  RECEIPT_EVENTS,
  type ReceiptEvent,
  type ReceiptEventKind,
  transition,
} from '../../../src/core/state';

/** Decimal digits are valid Crockford base32, so zero-padded numbers are ULIDs. */
const ulid = (n: number): string => String(n).padStart(26, '0');
const HASH = 'ab'.repeat(32);
const T_PENDING = '2026-10-06T14:20:00-04:00';
const T_FINAL = '2026-10-06T14:48:00-04:00';
const T_OVERRIDE = '2026-10-06T15:05:00-04:00';
const LATER_CLAIM = ulid(900);

const CLAIM_BASE = {
  id: ulid(1),
  agent: 'muse',
  claimId: ulid(2),
  observationIds: [],
  signals: {},
  policyHash: HASH,
  inputsHash: HASH,
};
const UNASKED_BASE = {
  id: ulid(11),
  agent: 'muse',
  observationIds: [ulid(12)],
  grade: 'UNASKED',
  confidence: 0.7,
  ruleId: 'unasked',
  reasons: [
    { code: 'unasked.session', params: { agent: 'muse' } },
    { code: 'unasked.idle', params: { agent: 'muse' } },
  ],
  signals: {},
  policyHash: HASH,
  inputsHash: HASH,
  attribution: 'likely',
};

const NOT_FOUND_REASONS = [
  { code: 'coverage.account_unbound', params: { source: 'gmail.sent' } },
  { code: 'match.none', params: {} },
];
const CLAIM_FINAL = Receipt.parse({
  ...CLAIM_BASE,
  grade: 'NOT_FOUND',
  confidence: 1,
  ruleId: 'not_found',
  reasons: NOT_FOUND_REASONS,
  state: 'FINAL',
  computedAt: T_FINAL,
  finalAt: T_FINAL,
});
const UNASKED_FINAL = Receipt.parse({
  ...UNASKED_BASE,
  state: 'FINAL',
  computedAt: T_FINAL,
  finalAt: T_FINAL,
});

const overridden = (receipt: Receipt, grade: 'VERIFIED' | 'NOT_FOUND'): Receipt =>
  Receipt.parse({
    ...receipt,
    state: 'USER_OVERRIDDEN',
    override: { grade, reason: 'Sent it from my phone', at: T_OVERRIDE, previousState: receipt.state },
    reasons: [...receipt.reasons, { code: 'override.user', params: { grade } }],
  });

type Kind = 'claim' | 'unasked';

const FIXTURES: Readonly<Record<Kind, Readonly<Record<ReceiptState, Receipt>>>> = {
  claim: {
    PENDING: Receipt.parse({
      ...CLAIM_BASE,
      grade: 'UNVERIFIABLE',
      confidence: 0,
      ruleId: 'pending',
      reasons: [
        { code: 'grace.waiting', params: { source: 'gmail.sent' } },
        { code: 'match.none', params: {} },
      ],
      state: 'PENDING',
      computedAt: T_PENDING,
    }),
    FINAL: CLAIM_FINAL,
    USER_OVERRIDDEN: overridden(CLAIM_FINAL, 'VERIFIED'),
  },
  unasked: {
    PENDING: Receipt.parse({ ...UNASKED_BASE, state: 'PENDING', computedAt: T_PENDING }),
    FINAL: UNASKED_FINAL,
    USER_OVERRIDDEN: overridden(UNASKED_FINAL, 'NOT_FOUND'),
  },
};

/** grade()'s next receipt for each subject: FINAL. */
const NEXT: Readonly<Record<Kind, Receipt>> = { claim: CLAIM_FINAL, unasked: UNASKED_FINAL };

/** One valid event of each kind; `regrade` carries grade()'s FINAL receipt for the same subject. */
const eventFor = (kind: Kind, event: ReceiptEventKind): ReceiptEvent => {
  switch (event) {
    case 'regrade':
      return { event, next: NEXT[kind] };
    case 'override':
      return { event, grade: 'NOT_FOUND', reason: 'I cancelled it myself', at: T_OVERRIDE };
    case 'revert':
      return { event };
    case 'supersede':
      return { event, claimId: LATER_CLAIM };
  }
};

type Outcome = { readonly to: ReceiptState } | { readonly throws: IllegalTransitionCode };
const to = (state: ReceiptState): Outcome => ({ to: state });
const throws = (code: IllegalTransitionCode): Outcome => ({ throws: code });

/** §8, written out pair by pair. Supersede depends on the grade (UNASKED only), not on the state. */
const TABLE: Readonly<
  Record<Kind, Readonly<Record<ReceiptState, Readonly<Record<ReceiptEventKind, Outcome>>>>>
> = {
  claim: {
    PENDING: {
      regrade: to('FINAL'),
      override: to('USER_OVERRIDDEN'),
      revert: throws('not_overridden'),
      supersede: throws('not_unasked'),
    },
    FINAL: {
      regrade: throws('regrade_final'),
      override: to('USER_OVERRIDDEN'),
      revert: throws('not_overridden'),
      supersede: throws('not_unasked'),
    },
    USER_OVERRIDDEN: {
      regrade: throws('regrade_overridden'),
      override: throws('already_overridden'),
      revert: to('FINAL'),
      supersede: throws('not_unasked'),
    },
  },
  unasked: {
    PENDING: {
      regrade: to('FINAL'),
      override: to('USER_OVERRIDDEN'),
      revert: throws('not_overridden'),
      supersede: to('PENDING'),
    },
    FINAL: {
      regrade: throws('regrade_final'),
      override: to('USER_OVERRIDDEN'),
      revert: throws('not_overridden'),
      supersede: to('FINAL'),
    },
    USER_OVERRIDDEN: {
      regrade: throws('regrade_overridden'),
      override: throws('already_overridden'),
      revert: to('FINAL'),
      supersede: to('USER_OVERRIDDEN'),
    },
  },
};

const KINDS: readonly Kind[] = ['claim', 'unasked'];
const ROWS = KINDS.flatMap((kind) =>
  ReceiptState.options.flatMap((state) =>
    RECEIPT_EVENTS.map((event) => ({ kind, state, event, outcome: TABLE[kind][state][event] })),
  ),
);

const LIFECYCLE: ReadonlySet<string> = new Set(['override.user', 'superseded']);
const NOT_COMPUTED: ReadonlySet<string> = new Set(['state', 'override', 'supersededBy', 'reasons']);

/** The receipt's reasons as §15 orders them: graded reasons, then override.user, then superseded. */
function lifecycleOrdered(receipt: Receipt): Reason[] {
  const graded = receipt.reasons.filter((reason) => !LIFECYCLE.has(reason.code));
  const tail: Reason[] = [];
  if (receipt.override) tail.push({ code: 'override.user', params: { grade: receipt.override.grade } });
  if (receipt.supersededBy) tail.push({ code: 'superseded', params: { claimId: receipt.supersededBy } });
  return [...graded, ...tail];
}

/** The fields grade() computed: every field but state, override, supersededBy and the lifecycle reasons. */
function computed(receipt: Receipt): Record<string, unknown> {
  const rest = Object.entries(receipt).filter(([key]) => !NOT_COMPUTED.has(key));
  return {
    ...Object.fromEntries(rest),
    reasons: receipt.reasons.filter((reason) => !LIFECYCLE.has(reason.code)),
  };
}

/** Freeze the receipt all the way down, so a transition that mutates its input throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    const children: unknown[] = Object.values(value);
    children.forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Run `fn` and return what it threw (fails the test when it returns). */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('state table: every (state, event) pair', () => {
  it('has one row per kind × ReceiptState × event, and the event list matches the event union', () => {
    expect(ROWS).toHaveLength(KINDS.length * ReceiptState.options.length * RECEIPT_EVENTS.length);
    expect(ROWS).toHaveLength(24);
    expectTypeOf<ReceiptEvent['event']>().toEqualTypeOf<ReceiptEventKind>();
    expect([...RECEIPT_EVENTS]).toEqual(['regrade', 'override', 'revert', 'supersede']);
  });

  it('the fixtures are the receipts they claim to be', () => {
    for (const kind of KINDS) {
      for (const state of ReceiptState.options) {
        expect(FIXTURES[kind][state].state).toBe(state);
        expect(FIXTURES[kind][state].grade === 'UNASKED').toBe(kind === 'unasked');
      }
    }
  });

  it.each(ROWS)('$kind receipt, $state + $event', ({ kind, state, event, outcome }) => {
    const receipt = deepFreeze(FIXTURES[kind][state]);
    const before = JSON.stringify(receipt);
    if ('throws' in outcome) {
      const error = thrown(() => transition(receipt, eventFor(kind, event)));
      expect(error).toBeInstanceOf(IllegalTransitionError);
      expect(error).toMatchObject({ code: outcome.throws, from: state, name: 'IllegalTransitionError' });
    } else {
      const result = transition(receipt, eventFor(kind, event));
      expect(result.state).toBe(outcome.to);
      expect(Receipt.safeParse(result).success).toBe(true);
      expect(result.id).toBe(receipt.id);
      expect(result.reasons).toEqual(lifecycleOrdered(result));
      if (event === 'regrade') expect(result).toStrictEqual(NEXT[kind]);
      else expect(computed(result)).toStrictEqual(computed(receipt));
    }
    expect(JSON.stringify(receipt)).toBe(before);
  });
});

describe('state table: what each legal pair stores', () => {
  it('override keeps the computed grade, ruleId and finalAt, and stores previousState', () => {
    for (const kind of KINDS) {
      for (const state of ['PENDING', 'FINAL'] as const) {
        const receipt = FIXTURES[kind][state];
        const result = transition(receipt, eventFor(kind, 'override'));
        expect(result.grade).toBe(receipt.grade);
        expect(result.ruleId).toBe(receipt.ruleId);
        expect(result.finalAt).toBe(receipt.finalAt);
        expect(result.override).toEqual({
          grade: 'NOT_FOUND',
          reason: 'I cancelled it myself',
          at: T_OVERRIDE,
          previousState: state,
        });
        expect(result.reasons.at(-1)).toEqual({ code: 'override.user', params: { grade: 'NOT_FOUND' } });
      }
    }
  });

  it('revert removes the override and its reason and returns to previousState', () => {
    for (const kind of KINDS) {
      const result = transition(FIXTURES[kind].USER_OVERRIDDEN, { event: 'revert' });
      expect(result).toStrictEqual(NEXT[kind]);
      expect(result.override).toBeUndefined();
      expect(result.reasons.map((reason) => reason.code)).not.toContain('override.user');
    }
  });

  it('supersede sets supersededBy and appends superseded {claimId}, in every state', () => {
    for (const state of ReceiptState.options) {
      const receipt = FIXTURES.unasked[state];
      const result = transition(receipt, eventFor('unasked', 'supersede'));
      expect(result.supersededBy).toBe(LATER_CLAIM);
      expect(result.state).toBe(receipt.state);
      expect(result.override).toEqual(receipt.override);
      expect(result.reasons).toEqual([
        ...receipt.reasons,
        { code: 'superseded', params: { claimId: LATER_CLAIM } },
      ]);
    }
  });

  it('regrade installs the next receipt exactly, PENDING → PENDING as well as PENDING → FINAL', () => {
    const pending = FIXTURES.claim.PENDING;
    const later = Receipt.parse({ ...pending, computedAt: T_OVERRIDE, inputsHash: 'cd'.repeat(32) });
    expect(transition(pending, { event: 'regrade', next: later })).toStrictEqual(later);
    expect(transition(pending, { event: 'regrade', next: CLAIM_FINAL })).toStrictEqual(CLAIM_FINAL);
  });

  it('a USER_OVERRIDDEN receipt overridden from PENDING reverts to PENDING, with no finalAt', () => {
    const pending = FIXTURES.claim.PENDING;
    const result = transition(overridden(pending, 'VERIFIED'), { event: 'revert' });
    expect(result).toStrictEqual(pending);
    expect(result.finalAt).toBeUndefined();
  });
});
