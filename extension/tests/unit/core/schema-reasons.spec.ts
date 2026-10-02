/**
 * docs/grading.md v1.2 §15 "Params per code (closed)": a Reason's params are exactly the ones its code lists,
 * each an id, a hash, an enum value or an integer, and a code with no params accepts only `{}`. So no reason
 * can carry an address, a name, a subject or a formatted local time (§6.4, Hard Rules 2 and 10). Same contract
 * as schema.spec.ts: five valid cases (each parses to exactly itself) and five invalid ones, each rejected at
 * one specific path; then every code on its own, and a property over arbitrary params.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { Reason, ReasonCode, ReasonParams, Receipt } from '../../../src/core/schema';

type Path = readonly (string | number)[];

const ULID = '01JA0000000000000000000001';
const HASH = 'ab'.repeat(32);
const T1 = '2026-10-06T15:00:00-04:00';

/** One valid params object per code, written from the §15 table (not from the code). */
const EXAMPLE: Readonly<Record<ReasonCode, Readonly<Record<string, string | number>>>> = {
  'match.best': { observationId: ULID },
  'match.none': {},
  'cp.plus_tag': {},
  'cp.confusable': {},
  'cp.non_ascii': {},
  'claim.too_vague': {},
  'claim.no_target': {},
  'coverage.none': { source: 'gmail.sent' },
  'coverage.partial': { source: 'gcal.event' },
  'coverage.account_unbound': { source: 'gmail.sent' },
  'coverage.calendars_hidden': { source: 'gcal.event' },
  'coverage.multiple_accounts': { source: 'gmail.receipt' },
  'coverage.no_account': { source: 'gmail.sent' },
  'coverage.never_completed': {},
  'grace.waiting': { source: 'gmail.sent' },
  'scope.type_not_allowed': { type: 'purchase.made' },
  'scope.counterparty_not_allowed': {},
  'allowlist.unchecked': {},
  'ceiling.exceeded': { amountCents: 20_000, ceilingCents: 5_000 },
  'ceiling.cumulative_exceeded': { priorSpendCents: 3_000, amountCents: 3_000, ceilingCents: 5_000 },
  'ceiling.currency_mismatch': { currency: 'EUR', spendCurrency: 'USD' },
  'scope.observed_not_declared': { scopeHash: HASH },
  'unasked.session': { agent: 'muse' },
  'unasked.idle': { agent: 'chatgpt' },
  'unasked.signature': { agent: 'dots' },
  'unasked.adjacent': { agent: 'claude' },
  'override.user': { grade: 'NOT_FOUND' },
  superseded: { claimId: ULID },
};

/** The codes whose `source` param may be omitted: "omitted for a type with no sources" (§15). */
const SOURCE_CODES: readonly ReasonCode[] = [
  'coverage.none',
  'coverage.partial',
  'coverage.account_unbound',
  'coverage.calendars_hidden',
  'coverage.multiple_accounts',
  'coverage.no_account',
  'grace.waiting',
];

const VALID: readonly unknown[] = [
  { code: 'match.best', params: { observationId: ULID } },
  { code: 'match.none', params: {} },
  { code: 'ceiling.exceeded', params: { amountCents: 20_000, ceilingCents: 5_000 } },
  { code: 'grace.waiting', params: { source: 'gmail.sent' } },
  { code: 'coverage.none', params: {} },
  { code: 'scope.observed_not_declared', params: { scopeHash: HASH } },
  {
    code: 'ceiling.cumulative_exceeded',
    params: { priorSpendCents: 2e12, amountCents: 1e12, ceilingCents: 0 },
  },
  { code: 'override.user', params: { grade: 'NOT_FOUND' } },
];

const INVALID: readonly (readonly [label: string, value: unknown, path: Path])[] = [
  ['an unknown code', { code: 'match.maybe', params: {} }, ['code']],
  ['missing params', { code: 'match.none' }, ['params']],
  [
    'an address in place of the observation id',
    { code: 'match.best', params: { observationId: 'priya@company.com' } },
    ['params', 'observationId'],
  ],
  [
    'an address under a param the code does not have',
    { code: 'match.best', params: { observationId: ULID, counterparty: 'priya@company.com' } },
    ['params', 'counterparty'],
  ],
  ['a name on a code with no params', { code: 'match.none', params: { name: 'Priya' } }, ['params', 'name']],
  [
    'a subject as the scope hash',
    { code: 'scope.observed_not_declared', params: { scopeHash: 'Q3 deck' } },
    ['params', 'scopeHash'],
  ],
  [
    'a formatted local time on grace.waiting',
    { code: 'grace.waiting', params: { source: 'gmail.sent', until: '3:17 PM' } },
    ['params', 'until'],
  ],
  ['a missing observation id', { code: 'match.best', params: {} }, ['params', 'observationId']],
  ['a lowercase id', { code: 'superseded', params: { claimId: ULID.toLowerCase() } }, ['params', 'claimId']],
  ['an unknown source', { code: 'coverage.none', params: { source: 'outlook' } }, ['params', 'source']],
  ['an unknown agent', { code: 'unasked.idle', params: { agent: 'gemini' } }, ['params', 'agent']],
  [
    'a fractional amount',
    { code: 'ceiling.exceeded', params: { amountCents: 1.5, ceilingCents: 1 } },
    ['params', 'amountCents'],
  ],
  [
    'an amount over 10^12',
    { code: 'ceiling.exceeded', params: { amountCents: 1e12 + 1, ceilingCents: 1 } },
    ['params', 'amountCents'],
  ],
  [
    'a negative prior spend',
    { code: 'ceiling.cumulative_exceeded', params: { priorSpendCents: -1, amountCents: 1, ceilingCents: 0 } },
    ['params', 'priorSpendCents'],
  ],
  [
    'a fractional prior spend',
    {
      code: 'ceiling.cumulative_exceeded',
      params: { priorSpendCents: 0.5, amountCents: 1, ceilingCents: 0 },
    },
    ['params', 'priorSpendCents'],
  ],
  [
    'a prior spend past 2^53',
    {
      code: 'ceiling.cumulative_exceeded',
      params: { priorSpendCents: 2 ** 53, amountCents: 1, ceilingCents: 0 },
    },
    ['params', 'priorSpendCents'],
  ],
  [
    'a lowercase currency',
    { code: 'ceiling.currency_mismatch', params: { currency: 'eur', spendCurrency: 'USD' } },
    ['params', 'currency'],
  ],
  [
    'a grade that is not a Grade',
    { code: 'override.user', params: { grade: 'CERTAIN' } },
    ['params', 'grade'],
  ],
  ['a numeric type', { code: 'scope.type_not_allowed', params: { type: 7 } }, ['params', 'type']],
  ['a boolean param', { code: 'match.none', params: { flag: true } }, ['params', 'flag']],
  [
    'a key that is not an identifier',
    { code: 'match.none', params: { 'first name': 1 } },
    ['params', 'first name'],
  ],
  ['a smuggled text', { code: 'match.none', params: {}, text: 'Sent email to Priya' }, []],
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

describe('Reason (closed params per code, §15)', () => {
  it('has at least five valid and five invalid cases', () => {
    expect(VALID.length).toBeGreaterThanOrEqual(5);
    expect(INVALID.length).toBeGreaterThanOrEqual(5);
  });

  it.each(VALID.map((value, index) => ({ index, value })))(
    'parses valid case $index to exactly itself',
    ({ value }) => {
      expect(Reason.parse(value)).toEqual(value);
    },
  );

  it.each(INVALID.map(([label, value, path]) => ({ label, value, path })))(
    'rejects $label at $path',
    ({ value, path }) => {
      expect(issuePaths(Reason, value)).toEqual([path]);
    },
  );

  it('reports every param a code does not have, each at its own path', () => {
    const params = { observationId: ULID, a: 1, b: 'x', c: HASH };
    expect(issuePaths(Reason, { code: 'match.best', params })).toEqual([
      ['params', 'a'],
      ['params', 'b'],
      ['params', 'c'],
    ]);
  });

  it('checks reasons inside a receipt at their full path', () => {
    const receipt = {
      id: ULID,
      agent: 'muse',
      claimId: ULID,
      observationIds: [],
      grade: 'NOT_FOUND',
      confidence: 1,
      ruleId: 'not_found',
      reasons: [
        { code: 'match.none', params: {} },
        { code: 'coverage.account_unbound', params: { email: 'p@x.io' } },
      ],
      signals: {},
      state: 'PENDING',
      policyHash: HASH,
      inputsHash: HASH,
      computedAt: T1,
    };
    expect(issuePaths(Receipt, receipt)).toEqual([['reasons', 1, 'params', 'email']]);
  });
});

describe('ReasonParams: one strict schema per ReasonCode', () => {
  it('covers exactly the ReasonCode vocabulary', () => {
    expect([...ReasonParams.keys()]).toEqual(ReasonCode.options);
    expect(Object.keys(EXAMPLE).sort()).toEqual([...ReasonCode.options].sort());
  });

  it.each(ReasonCode.options)('%s: the §15 params parse, and nothing else rides along', (code) => {
    const params = EXAMPLE[code];
    expect(Reason.parse({ code, params })).toEqual({ code, params });
    expect(issuePaths(Reason, { code, params: { ...params, subject: 'Q3 deck' } })).toEqual([
      ['params', 'subject'],
    ]);
    const required = Object.keys(params).filter(
      (name) => !(name === 'source' && SOURCE_CODES.includes(code)),
    );
    for (const name of required) {
      const missing = Object.fromEntries(Object.entries(params).filter(([key]) => key !== name));
      expect(issuePaths(Reason, { code, params: missing }), name).toEqual([['params', name]]);
    }
  });

  it('a code with no params accepts only {}', () => {
    const none = ReasonCode.options.filter((code) => Object.keys(EXAMPLE[code]).length === 0);
    expect(none).toEqual([
      'match.none',
      'cp.plus_tag',
      'cp.confusable',
      'cp.non_ascii',
      'claim.too_vague',
      'claim.no_target',
      'coverage.never_completed',
      'scope.counterparty_not_allowed',
      'allowlist.unchecked',
    ]);
    for (const code of none) {
      expect(Reason.safeParse({ code, params: {} }).success).toBe(true);
      expect(issuePaths(Reason, { code, params: { observationId: ULID } })).toEqual([
        ['params', 'observationId'],
      ]);
    }
  });

  it('only the coverage and grace codes may omit their source', () => {
    for (const code of ReasonCode.options) {
      const omitted = Reason.safeParse({ code, params: {} }).success;
      const hasNone = Object.keys(EXAMPLE[code]).length === 0;
      expect(omitted, code).toBe(hasNone || SOURCE_CODES.includes(code));
    }
  });
});

describe('Reason params never carry content (property)', () => {
  /** Ids, hashes, enum values and currency codes: no '@', no space, no lowercase-free prose. */
  const SAFE_STRING = /^(?:[0-7][0-9A-HJKMNP-TV-Z]{25}|[0-9a-f]{64}|[a-z]+(?:[._][a-z]+)*|[A-Z_]+)$/;

  it('a parsed reason holds only ids, hashes, enum values and integers, whatever params were offered', () => {
    let parsedWithParams = 0;
    const value = fc.oneof(
      fc.string({ maxLength: 70 }),
      fc.constantFrom(ULID, HASH, 'priya@company.com', 'Priya Shah', 'Q3 deck', '3:17 PM', 'USD', 'muse'),
      fc.integer(),
      fc.double(),
    );
    const name = fc.constantFrom(
      'observationId',
      'source',
      'type',
      'agent',
      'grade',
      'claimId',
      'scopeHash',
      'name',
    );
    // The code's own §15 params (or none), overlaid with arbitrary values under plausible and implausible names.
    const offered = fc
      .tuple(fc.constantFrom(...ReasonCode.options), fc.boolean(), fc.dictionary(name, value, { maxKeys: 3 }))
      .map(([code, fromExample, noise]) => ({
        code,
        params: fromExample ? { ...EXAMPLE[code], ...noise } : noise,
      }));
    fc.assert(
      fc.property(offered, ({ code, params }) => {
        const result = Reason.safeParse({ code, params });
        if (!result.success) return;
        if (Object.keys(params).length > 0) parsedWithParams += 1;
        for (const param of Object.values(result.data.params)) {
          if (typeof param === 'number') expect(Number.isSafeInteger(param)).toBe(true);
          else expect(param).toMatch(SAFE_STRING);
        }
      }),
      { numRuns: 2_000 },
    );
    // Not vacuous: valid params were offered and accepted often enough to have been checked.
    expect(parsedWithParams).toBeGreaterThan(10);
  });
});
