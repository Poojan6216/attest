/**
 * Task 1.8: cumulative spend and the scope diff (docs/grading.md §6.1 observedScopeExceedsDeclared, §6.3).
 * The OVER_SCOPE outcomes themselves come from grade() and are asserted in scope-grade.spec.ts; this file pins
 * the two inputs scope.ts gives it: `context.priorSpendCents` and the claim-less scope subjects.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { NormalizeError } from '../../../src/core/normalize';
import { priorSpendCents, ScopeError, type SpendClaim, scopeSubjects } from '../../../src/core/scope';
import { MS_PER_DAY } from '../../../src/core/units';
import defaultPolicyJson from '../../../../policy/default.json';

const CEILING = 5_000;
const THIRTY_DOLLARS = 3_000;

let nextId = 0;
const spend = (fields: Partial<SpendClaim> & Pick<SpendClaim, 'claimedAt'>): SpendClaim => {
  nextId += 1;
  return {
    id: `C${String(nextId).padStart(25, '0')}`,
    agent: 'muse',
    type: 'purchase.made',
    amountCents: THIRTY_DOLLARS,
    currency: 'USD',
    ...fields,
  };
};

describe('priorSpendCents (§6.3)', () => {
  it('two $30 purchases against a $50 ceiling: the second sees $30 before it and goes over', () => {
    const first = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const second = spend({ claimedAt: '2026-10-06T11:00:00-04:00' });
    const claims = [first, second];
    expect(priorSpendCents(first, claims, DEFAULT_POLICY)).toBe(0);
    expect(priorSpendCents(second, claims, DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
    expect(0 + THIRTY_DOLLARS).toBeLessThanOrEqual(CEILING);
    expect(priorSpendCents(second, claims, DEFAULT_POLICY) + THIRTY_DOLLARS).toBeGreaterThan(CEILING);
  });

  it('reads the order of instants, not of the list or the strings', () => {
    const later = spend({ claimedAt: '2026-10-06T15:00:00Z' }); // 11:00 at -04:00
    const earlier = spend({ claimedAt: '2026-10-06T10:00:00-04:00' }); // 14:00Z
    expect(priorSpendCents(later, [later, earlier], DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
    expect(priorSpendCents(earlier, [later, earlier], DEFAULT_POLICY)).toBe(0);
  });

  it('the claim itself never counts', () => {
    const only = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    expect(priorSpendCents(only, [only, only], DEFAULT_POLICY)).toBe(0);
  });

  it('at the same instant, the smaller id is first: (claimedAt ms, id) order', () => {
    const a = spend({ id: '0000000000000000000000000A', claimedAt: '2026-10-06T10:00:00-04:00' });
    const b = spend({ id: '0000000000000000000000000B', claimedAt: '2026-10-06T14:00:00Z' });
    expect(priorSpendCents(b, [a, b], DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
    expect(priorSpendCents(a, [a, b], DEFAULT_POLICY)).toBe(0);
  });

  it('golden 65: the window is [t − spendWindowDays, t]; 1 ms before its start is out, its start is in', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const days = DEFAULT_POLICY.windows.spendWindowDays;
    const startMs = Date.parse(claim.claimedAt) - days * MS_PER_DAY;
    const atStart = spend({ claimedAt: new Date(startMs).toISOString() });
    const justBefore = spend({ claimedAt: new Date(startMs - 1).toISOString() });
    expect(priorSpendCents(claim, [justBefore], DEFAULT_POLICY)).toBe(0);
    expect(priorSpendCents(claim, [atStart], DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
  });

  it('a later claim never counts, even inside the window length', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    expect(
      priorSpendCents(claim, [spend({ claimedAt: '2026-10-06T10:00:00.001-04:00' })], DEFAULT_POLICY),
    ).toBe(0);
  });
});

describe('priorSpendCents (§6.3): which claims count', () => {
  it.each([
    ['another agent', { agent: 'chatgpt' as const }],
    ['another currency', { currency: 'EUR' }],
    ['no currency, against a USD claim', { currency: undefined }],
    ['a type outside spendTypes', { type: 'listing.posted' as const }],
    ['an email claim', { type: 'email.sent' as const }],
  ])('excludes %s', (_label, fields) => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const other = spend({ claimedAt: '2026-10-06T09:00:00-04:00', ...fields });
    expect(priorSpendCents(claim, [other], DEFAULT_POLICY)).toBe(0);
  });

  it('a claim that is not itself a spend type has no cumulative spend', () => {
    const earlier = spend({ claimedAt: '2026-10-06T09:00:00-04:00' });
    const email = spend({ claimedAt: '2026-10-06T10:00:00-04:00', type: 'email.sent' });
    expect(priorSpendCents(email, [earlier, email], DEFAULT_POLICY)).toBe(0);
  });

  it('counts every spend type (subscription.changed too) in the same currency', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const subscription = spend({ claimedAt: '2026-10-05T10:00:00-04:00', type: 'subscription.changed' });
    expect(priorSpendCents(claim, [subscription], DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
  });

  it('a claim without a currency counts only earlier claims without one', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00', currency: undefined });
    const bare = spend({ claimedAt: '2026-10-06T09:00:00-04:00', currency: undefined });
    const usd = spend({ claimedAt: '2026-10-06T09:30:00-04:00' });
    expect(priorSpendCents(claim, [bare, usd], DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
  });

  it('an earlier claim without an amount adds nothing', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    expect(
      priorSpendCents(
        claim,
        [spend({ claimedAt: '2026-10-06T09:00:00-04:00', amountCents: undefined })],
        DEFAULT_POLICY,
      ),
    ).toBe(0);
  });
});

describe('priorSpendCents (§6.3): sums and policy', () => {
  it('golden 65: sums several earlier claims exactly (c6 sees c4 + c5 = 5000)', () => {
    const c4 = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const c5 = spend({ claimedAt: '2026-10-06T10:30:00-04:00', amountCents: 2_000 });
    const c6 = spend({ claimedAt: '2026-10-06T11:00:00-04:00', amountCents: 1 });
    expect(priorSpendCents(c6, [c4, c5, c6], DEFAULT_POLICY)).toBe(CEILING);
  });

  it('a claim listed twice (batch claims plus ledger claims) counts once', () => {
    const first = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const second = spend({ claimedAt: '2026-10-06T11:00:00-04:00' });
    expect(priorSpendCents(second, [first, second, first, second], DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
  });

  it('spendTypes and spendWindowDays are policy data', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00', type: 'listing.posted' });
    const earlier = spend({ claimedAt: '2026-10-04T10:00:00-04:00', type: 'listing.posted' });
    expect(priorSpendCents(claim, [earlier], DEFAULT_POLICY)).toBe(0);
    const policy = loadPolicy({
      ...defaultPolicyJson,
      spendTypes: [...defaultPolicyJson.spendTypes, 'listing.posted'],
      windows: { ...defaultPolicyJson.windows, spendWindowDays: 1 },
    });
    expect(priorSpendCents(claim, [earlier], policy)).toBe(0);
    const yesterday = spend({ claimedAt: '2026-10-05T10:00:00-04:00', type: 'listing.posted' });
    expect(priorSpendCents(claim, [yesterday], policy)).toBe(THIRTY_DOLLARS);
  });
});

describe('priorSpendCents (§6.3): totals and bad input', () => {
  it('sums in exact integers and saturates at Number.MAX_SAFE_INTEGER (already over every ceiling)', () => {
    const max = 1_000_000_000_000;
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const many = Array.from({ length: 9_100 }, (_unused, index) =>
      spend({
        claimedAt: new Date(Date.parse('2026-10-06T09:00:00-04:00') - index).toISOString(),
        amountCents: max,
      }),
    );
    expect(priorSpendCents(claim, many, DEFAULT_POLICY)).toBe(Number.MAX_SAFE_INTEGER);
    expect(priorSpendCents(claim, many.slice(0, 9_000), DEFAULT_POLICY)).toBe(9_000 * max);
  });

  it.each([
    ['a negative amount', -1],
    ['a fractional amount', 1.5],
    ['NaN', Number.NaN],
  ])('rejects %s with ScopeError (never a lowered or rounded total)', (_label, amountCents) => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const bad = spend({ claimedAt: '2026-10-06T09:00:00-04:00', amountCents });
    expect(() => priorSpendCents(claim, [bad], DEFAULT_POLICY)).toThrow(ScopeError);
  });

  it('a claim edited in place is read at its new instant (the parse memo never serves a stale time)', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00-04:00' });
    const prior: { -readonly [K in keyof SpendClaim]: SpendClaim[K] } = {
      ...spend({ claimedAt: '2026-10-06T09:00:00-04:00' }),
    };
    expect(priorSpendCents(claim, [prior], DEFAULT_POLICY)).toBe(THIRTY_DOLLARS);
    prior.claimedAt = '2026-10-06T11:00:00-04:00';
    expect(priorSpendCents(claim, [prior], DEFAULT_POLICY)).toBe(0);
  });

  it('rejects a timestamp without an offset (NormalizeError)', () => {
    const claim = spend({ claimedAt: '2026-10-06T10:00:00' });
    expect(() => priorSpendCents(claim, [], DEFAULT_POLICY)).toThrow(NormalizeError);
  });
});

describe('scopeSubjects (§6.1, §3)', () => {
  const grant = (declaredScopes: string[], observedScopes?: string[]) =>
    observedScopes === undefined ? { declaredScopes } : { declaredScopes, observedScopes };

  it('golden 50: the observed scopes that were not declared', () => {
    expect(
      scopeSubjects(grant(['gmail.send', 'calendar.write'], ['gmail.send', 'gmail.read', 'calendar.write'])),
    ).toEqual(['gmail.read']);
  });

  it('sorted by code unit and de-duplicated', () => {
    expect(
      scopeSubjects(grant([], ['payments', 'gmail.read', 'Zeta', 'gmail.read', 'calendar.write'])),
    ).toEqual(['Zeta', 'calendar.write', 'gmail.read', 'payments']);
  });

  it('compares exactly as stored: case and whitespace differences are undeclared', () => {
    expect(scopeSubjects(grant(['gmail.read'], ['Gmail.Read', 'gmail.read ', 'gmail.read']))).toEqual([
      'Gmail.Read',
      'gmail.read ',
    ]);
  });

  it('declared scopes the agent does not hold yield nothing', () => {
    expect(scopeSubjects(grant(['gmail.send', 'calendar.write'], ['gmail.send']))).toEqual([]);
  });

  it('a grant with no observed scopes (settings page never read) yields nothing', () => {
    expect(scopeSubjects(grant(['gmail.send']))).toEqual([]);
    expect(scopeSubjects(grant([], []))).toEqual([]);
  });

  it('does not modify the grant', () => {
    const observed = ['b', 'a', 'b'];
    const input = grant([], observed);
    scopeSubjects(input);
    expect(observed).toEqual(['b', 'a', 'b']);
  });
});
