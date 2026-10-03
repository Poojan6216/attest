/**
 * The Receipt schema and its invariants (src/core/schema.ts, src/core/schema-receipt.ts; docs/grading.md §2, §3,
 * §7, §8, §15). Same contract as schema.spec.ts: at least five valid cases per table (each parses to exactly
 * itself) and five invalid ones, each rejected at one specific path. Contract v1.4 adds two invariants:
 *  - `override.at ≥ computedAt` (as instants), reported at `override.at`;
 *  - the lifecycle reasons: `override.user {grade: override.grade}` iff `override`, `superseded {claimId:
 *    supersededBy}` iff `supersededBy`, each once, after every graded reason, in §15 order; reported at
 *    `reasons`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { Receipt } from '../../../src/core/schema';

type Path = readonly (string | number)[];
type Invalid = readonly [label: string, value: unknown, path: Path];
interface Table {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly Invalid[];
}

const ULID = '01JA0000000000000000000001';
const ULID_B = '01JA0000000000000000000002';
const ULID_C = '01JA0000000000000000000003';
const HASH = 'ab'.repeat(32);
const T1 = '2026-10-06T15:00:00-04:00';

/** A copy of `value` without `key`. */
function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

const OVERRIDE = { grade: 'NOT_FOUND', reason: 'I cancelled it myself', at: T1, previousState: 'PENDING' };
/** §8 (v1.4): the lifecycle reasons an override and a supersession imply, last and in §15 order. */
const OVERRIDE_USER = { code: 'override.user', params: { grade: 'NOT_FOUND' } };
const SUPERSEDED = { code: 'superseded', params: { claimId: ULID } };

const RECEIPT = {
  id: ULID_B,
  agent: 'muse',
  claimId: ULID,
  observationIds: [ULID],
  grade: 'VERIFIED',
  confidence: 1,
  ruleId: 'verified',
  reasons: [{ code: 'match.best', params: { observationId: ULID } }],
  signals: { timeProximity: 1, score: 1 },
  state: 'PENDING',
  policyHash: HASH,
  inputsHash: HASH,
  computedAt: T1,
};
const FINAL = { ...RECEIPT, state: 'FINAL', finalAt: T1 };
const UNASKED = {
  ...without(RECEIPT, 'claimId'),
  grade: 'UNASKED',
  ruleId: 'unasked',
  attribution: 'likely',
  reasons: [{ code: 'unasked.session', params: { agent: 'muse' } }],
};

const TABLES: readonly Table[] = [
  {
    name: 'Receipt',
    schema: Receipt,
    valid: [
      RECEIPT,
      FINAL,
      UNASKED,
      {
        ...UNASKED,
        state: 'FINAL',
        finalAt: T1,
        supersededBy: ULID,
        reasons: [...UNASKED.reasons, SUPERSEDED],
      },
      {
        ...RECEIPT,
        state: 'USER_OVERRIDDEN',
        override: OVERRIDE,
        reasons: [...RECEIPT.reasons, OVERRIDE_USER],
      },
      {
        ...FINAL,
        state: 'USER_OVERRIDDEN',
        override: { ...OVERRIDE, previousState: 'FINAL' },
        reasons: [...FINAL.reasons, OVERRIDE_USER],
      },
      {
        ...without(RECEIPT, 'claimId'),
        grade: 'OVER_SCOPE',
        ruleId: 'over_scope_observed',
        observationIds: [],
      },
      { ...RECEIPT, grade: 'UNVERIFIABLE', ruleId: 'pending', confidence: 0, reasons: [], signals: {} },
    ],
    invalid: [
      ['FINAL without finalAt', without(FINAL, 'finalAt'), ['finalAt']],
      ['PENDING with finalAt', { ...RECEIPT, finalAt: T1 }, ['finalAt']],
      ['USER_OVERRIDDEN without override', { ...RECEIPT, state: 'USER_OVERRIDDEN' }, ['override']],
      [
        'an override on a FINAL receipt',
        { ...FINAL, override: OVERRIDE, reasons: [...FINAL.reasons, OVERRIDE_USER] },
        ['override'],
      ],
      [
        'overridden from FINAL without finalAt',
        {
          ...RECEIPT,
          state: 'USER_OVERRIDDEN',
          override: { ...OVERRIDE, previousState: 'FINAL' },
          reasons: [...RECEIPT.reasons, OVERRIDE_USER],
        },
        ['finalAt'],
      ],
      [
        'overridden from PENDING with finalAt',
        {
          ...FINAL,
          state: 'USER_OVERRIDDEN',
          override: OVERRIDE,
          reasons: [...FINAL.reasons, OVERRIDE_USER],
        },
        ['finalAt'],
      ],
      ['UNASKED without attribution', without(UNASKED, 'attribution'), ['attribution']],
      ['UNASKED with a claim', { ...UNASKED, claimId: ULID }, ['claimId']],
      ['attribution on VERIFIED', { ...RECEIPT, attribution: 'likely' }, ['attribution']],
      [
        'supersededBy on VERIFIED',
        { ...RECEIPT, supersededBy: ULID, reasons: [...RECEIPT.reasons, SUPERSEDED] },
        ['supersededBy'],
      ],
      ['attribution stated as fact', { ...UNASKED, attribution: 'certain' }, ['attribution']],
      ['a missing agent', without(RECEIPT, 'agent'), ['agent']],
      ['a missing policyHash', without(RECEIPT, 'policyHash'), ['policyHash']],
      ['a leftover index date', { ...RECEIPT, date: '2026-10-06' }, []],
      ['a free-text reason', { ...RECEIPT, reasons: ['Sent email found'] }, ['reasons', 0]],
      ['a ruleId with spaces', { ...RECEIPT, ruleId: 'not found' }, ['ruleId']],
      ['a confidence above 1', { ...RECEIPT, confidence: 1.01 }, ['confidence']],
      [
        'a signal key with a space',
        { ...RECEIPT, signals: { 'time proximity': 1 } },
        ['signals', 'time proximity'],
      ],
      ['a signal that is no §5.1 feature', { ...RECEIPT, signals: { userIdle: 1 } }, ['signals', 'userIdle']],
    ],
  },
];

/** An UNASKED receipt overridden from FINAL and superseded: both lifecycle reasons, in order. */
const BOTH = {
  ...UNASKED,
  state: 'USER_OVERRIDDEN',
  finalAt: T1,
  override: { ...OVERRIDE, previousState: 'FINAL' },
  supersededBy: ULID,
  reasons: [...UNASKED.reasons, OVERRIDE_USER, SUPERSEDED],
};
const OVERRIDDEN = {
  ...RECEIPT,
  state: 'USER_OVERRIDDEN',
  override: OVERRIDE,
  reasons: [...RECEIPT.reasons, OVERRIDE_USER],
};
const SUPERSEDED_FINAL = {
  ...UNASKED,
  state: 'FINAL',
  finalAt: T1,
  supersededBy: ULID,
  reasons: [...UNASKED.reasons, SUPERSEDED],
};
const at = (when: string) => ({ ...OVERRIDDEN, override: { ...OVERRIDE, at: when } });
const MATCH_NONE = { code: 'match.none', params: {} };

const V14_TABLES: readonly Table[] = [
  {
    name: 'Receipt lifecycle reasons (§8, §15, v1.4)',
    schema: Receipt,
    valid: [
      OVERRIDDEN,
      SUPERSEDED_FINAL,
      BOTH,
      { ...OVERRIDDEN, reasons: [OVERRIDE_USER] }, // an override of a receipt with no graded reason
      {
        ...BOTH,
        override: { ...OVERRIDE, grade: 'VERIFIED', previousState: 'FINAL' },
        reasons: [...UNASKED.reasons, { code: 'override.user', params: { grade: 'VERIFIED' } }, SUPERSEDED],
      },
      { ...OVERRIDDEN, reasons: [...RECEIPT.reasons, MATCH_NONE, OVERRIDE_USER] },
    ],
    invalid: [
      ['an override with no override.user', { ...OVERRIDDEN, reasons: RECEIPT.reasons }, ['reasons']],
      [
        'override.user with no override',
        { ...RECEIPT, reasons: [...RECEIPT.reasons, OVERRIDE_USER] },
        ['reasons'],
      ],
      [
        'override.user naming another grade',
        { ...OVERRIDDEN, override: { ...OVERRIDE, grade: 'VERIFIED' } },
        ['reasons'],
      ],
      [
        'override.user twice',
        { ...OVERRIDDEN, reasons: [...OVERRIDDEN.reasons, OVERRIDE_USER] },
        ['reasons'],
      ],
      [
        'override.user before a graded reason',
        { ...OVERRIDDEN, reasons: [OVERRIDE_USER, ...RECEIPT.reasons] },
        ['reasons'],
      ],
      [
        'supersededBy with no superseded reason',
        { ...SUPERSEDED_FINAL, reasons: UNASKED.reasons },
        ['reasons'],
      ],
      [
        'superseded with no supersededBy',
        { ...UNASKED, reasons: [...UNASKED.reasons, SUPERSEDED] },
        ['reasons'],
      ],
      ['superseded naming another claim', { ...SUPERSEDED_FINAL, supersededBy: ULID_C }, ['reasons']],
      [
        'superseded twice',
        { ...SUPERSEDED_FINAL, reasons: [...SUPERSEDED_FINAL.reasons, SUPERSEDED] },
        ['reasons'],
      ],
      [
        'superseded before override.user',
        { ...BOTH, reasons: [...UNASKED.reasons, SUPERSEDED, OVERRIDE_USER] },
        ['reasons'],
      ],
      [
        'a graded reason after superseded',
        { ...SUPERSEDED_FINAL, reasons: [SUPERSEDED, ...UNASKED.reasons] },
        ['reasons'],
      ],
    ],
  },
  {
    name: 'Receipt override.at ≥ computedAt (§8, v1.4)',
    schema: Receipt,
    valid: [
      at(T1), // equal is allowed
      at('2026-10-06T19:00:00Z'), // the same instant in another offset
      at('2026-10-06T15:00:00.001-04:00'),
      at('2026-10-07T09:00:00+05:30'),
      at('2026-10-06T19:00:01Z'),
    ],
    invalid: [
      ['one ms before computedAt', at('2026-10-06T14:59:59.999-04:00'), ['override', 'at']],
      ['a day before', at('2026-10-05T15:00:00-04:00'), ['override', 'at']],
      [
        'earlier as an instant although the string sorts after',
        at('2026-10-06T18:59:00Z'),
        ['override', 'at'],
      ],
      ['earlier in a far-east offset', at('2026-10-07T04:59:00+10:00'), ['override', 'at']],
      [
        'an at without offset (reported once, at its own path)',
        at('2026-10-06T16:00:00'),
        ['override', 'at'],
      ],
      [
        'a computedAt after the override',
        { ...OVERRIDDEN, computedAt: '2026-10-06T15:00:01-04:00' },
        ['override', 'at'],
      ],
    ],
  },
];

/** The distinct paths of every issue a parse raised; empty when it parsed. */
function issuePaths(schema: z.ZodType, value: unknown): Path[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  const paths = result.error.issues.map((issue) =>
    issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
  );
  return [...new Map(paths.map((path) => [JSON.stringify(path), path])).values()];
}

/** The messages of every issue a parse raised. */
function messages(value: unknown): string[] {
  return Receipt.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
}

describe.each([...TABLES, ...V14_TABLES])('$name', ({ schema, valid, invalid }) => {
  it('has at least five valid and five invalid cases', () => {
    expect(valid.length).toBeGreaterThanOrEqual(5);
    expect(invalid.length).toBeGreaterThanOrEqual(5);
  });

  it.each(valid.map((value, index) => ({ index, value })))(
    'parses valid case $index to exactly itself',
    ({ value }) => {
      expect(schema.parse(value)).toEqual(value);
    },
  );

  it.each(invalid.map(([label, value, path]) => ({ label, value, path })))(
    'rejects $label at $path',
    ({ value, path }) => {
      expect(issuePaths(schema, value)).toEqual([path]);
    },
  );
});

describe('the v1.4 receipt messages say which rule failed', () => {
  it('names the lifecycle rule and the override time rule', () => {
    expect(messages({ ...OVERRIDDEN, reasons: RECEIPT.reasons })).toEqual([
      'override.user is required exactly once with override',
    ]);
    expect(messages({ ...RECEIPT, reasons: [...RECEIPT.reasons, OVERRIDE_USER] })).toEqual([
      'override.user is allowed only with override',
    ]);
    expect(messages({ ...SUPERSEDED_FINAL, supersededBy: ULID_C })).toEqual([
      'superseded claimId must equal supersededBy',
    ]);
    expect(messages({ ...BOTH, reasons: [...UNASKED.reasons, SUPERSEDED, OVERRIDE_USER] })).toEqual([
      'override.user and superseded come after every graded reason, in that order',
    ]);
    expect(messages(at('2026-10-06T14:00:00-04:00'))).toEqual(['must not be before computedAt']);
  });

  it('a reason that is not a reason is reported at its own path, never thrown on', () => {
    for (const bad of [
      null,
      'override.user',
      { code: 'override.user' },
      { params: { grade: 'NOT_FOUND' } },
    ]) {
      const paths = issuePaths(Receipt, { ...OVERRIDDEN, reasons: [...RECEIPT.reasons, bad] });
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.some((path) => path[0] === 'reasons' && path[1] === 1)).toBe(true);
    }
  });
});

const GRADED = [RECEIPT.reasons[0], MATCH_NONE, { code: 'cp.plus_tag', params: {} }] as const;

describe('lifecycle reasons: accepted exactly in the §15 order (property)', () => {
  it('a receipt parses iff its reasons are its graded reasons, then override.user, then superseded', () => {
    const lifecycleArb = fc.constantFrom(OVERRIDE_USER, SUPERSEDED);
    const arbitrary = fc.record({
      overridden: fc.boolean(),
      superseded: fc.boolean(),
      reasons: fc.array(fc.oneof(fc.constantFrom(...GRADED), lifecycleArb), { maxLength: 6 }),
    });
    fc.assert(
      fc.property(arbitrary, ({ overridden, superseded, reasons }) => {
        const base = overridden ? { ...UNASKED, state: 'USER_OVERRIDDEN', override: OVERRIDE } : UNASKED;
        const receipt = { ...base, ...(superseded ? { supersededBy: ULID } : {}), reasons };
        const graded = reasons.filter((reason) => !(reason === OVERRIDE_USER || reason === SUPERSEDED));
        const expected = [
          ...graded,
          ...(overridden ? [OVERRIDE_USER] : []),
          ...(superseded ? [SUPERSEDED] : []),
        ];
        expect(Receipt.safeParse(receipt).success).toBe(JSON.stringify(reasons) === JSON.stringify(expected));
      }),
      { numRuns: 1_000 },
    );
  });
});
