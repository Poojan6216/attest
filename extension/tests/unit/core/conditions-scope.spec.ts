/**
 * Task 1.5: the permission conditions (docs/grading.md §6.1), each with its not-applicable cases:
 * `typeNotInGrant`, `targetMissing`, `counterpartyNotAllowed`, `amountAboveCeiling`, `cumulativeAboveCeiling`,
 * `observedScopeExceedsDeclared`, `unaskedLikely`. `null` means NOT APPLICABLE.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import {
  amountAboveCeiling,
  counterpartyNotAllowed,
  cumulativeAboveCeiling,
  observedScopeExceedsDeclared,
  targetMissing,
  typeNotInGrant,
  unaskedLikely,
} from '../../../src/core/conditions';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { Attribution, type Claim, type Grant, type Observation } from '../../../src/core/schema';
import { buildClaim, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, ScenarioObservation, type ScenarioGrant } from '../../golden/scenario-schema';

const EVAL = '2026-10-06T15:00:00-04:00';
const VIEW = PolicyView.parse(defaultPolicyJson);
const P = DEFAULT_POLICY;

function without(value: Record<string, unknown>, omit: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)));
}

function claimOf(over: Record<string, unknown> = {}, omit: readonly string[] = []): Claim {
  const base = {
    ref: 'c1',
    agent: 'muse',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    claimedAt: '2026-10-06T14:02:00-04:00',
    ...over,
  };
  return buildClaim(ScenarioClaim.parse(without(base, omit)));
}

function observationOf(over: Record<string, unknown> = {}, omit: readonly string[] = []): Observation {
  const base = {
    ref: 'o1',
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    occurredAt: '2026-10-06T14:02:00-04:00',
    observedAt: '2026-10-06T14:30:00-04:00',
    ...over,
  };
  return buildObservation(ScenarioObservation.parse(without(base, omit)), [], EVAL, VIEW);
}

const grantOf = (over: Partial<ScenarioGrant> = {}): Grant => buildGrant({ agent: 'muse', ...over }, EVAL);

describe('typeNotInGrant and targetMissing', () => {
  it('typeNotInGrant is true iff the claim type is not allowed', () => {
    expect(typeNotInGrant(claimOf(), grantOf())).toBe(false);
    expect(typeNotInGrant(claimOf(), grantOf({ allowedTypes: ['calendar.created'] }))).toBe(true);
    expect(typeNotInGrant(claimOf(), grantOf({ allowedTypes: [] }))).toBe(true);
  });

  it('targetMissing is true only for a calendar claim without targetAt', () => {
    expect(targetMissing(claimOf({ type: 'calendar.created' }))).toBe(true);
    expect(targetMissing(claimOf({ type: 'calendar.deleted', targetAt: EVAL }))).toBe(false);
    expect(targetMissing(claimOf())).toBe(false);
  });
});

/** `counterpartyNotAllowed` under a grant with `allowlist`, with `assigned` as the assigned candidate. */
const allowCheck = (claim: Claim, allowlist: readonly string[], assigned: Observation | null = null) =>
  counterpartyNotAllowed(claim, assigned, grantOf({ counterpartyAllowlist: [...allowlist] }), P);

describe('counterpartyNotAllowed (§6.1): how an address matches an entry', () => {
  const check = allowCheck;

  it('is false for a type outside allowlistTypes or with an empty allowlist', () => {
    const purchase = claimOf({ type: 'purchase.made', counterparty: 'evil@evil.example' });
    expect(check(purchase, ['company.com'])).toEqual({ value: false, candidateOnly: false });
    expect(check(claimOf({ counterparty: 'evil@evil.example' }), [])).toEqual({
      value: false,
      candidateOnly: false,
    });
  });

  it('an address entry matches only the identical address, after ASCII lowercasing', () => {
    expect(check(claimOf(), ['Priya@Company.COM'])?.value).toBe(false);
    expect(check(claimOf({ counterparty: 'raj@company.com' }), ['priya@company.com'])?.value).toBe(true);
    expect(check(claimOf({ counterparty: 'priya+x@company.com' }), ['priya@company.com'])?.value).toBe(true);
  });

  it('a domain entry matches the domain and its subdomains, never a lookalike suffix', () => {
    expect(check(claimOf(), ['company.com'])?.value).toBe(false);
    expect(check(claimOf({ counterparty: 'p@mail.company.com' }), ['company.com'])?.value).toBe(false);
    expect(check(claimOf({ counterparty: 'p@evilcompany.com' }), ['company.com'])?.value).toBe(true);
    expect(check(claimOf({ counterparty: 'p@company.com.evil' }), ['company.com'])?.value).toBe(true);
  });

  it('a confusable address never matches', () => {
    const dotless = claimOf({ counterparty: 'prıya@company.com' });
    expect(check(dotless, ['company.com'])?.value).toBe(true);
    expect(check(dotless, ['prıya@company.com'])?.value).toBe(true);
    expect(check(claimOf({ counterparty: 'p@xn--cmpany-qta.com' }), ['xn--cmpany-qta.com'])?.value).toBe(
      true,
    );
  });
});

describe('counterpartyNotAllowed (§6.1): which addresses are read', () => {
  const check = allowCheck;

  it('not applicable with no known address: a name or no counterparty, and no assigned candidate', () => {
    expect(check(claimOf({ counterparty: 'Priya' }), ['company.com'])).toBeNull();
    expect(check(claimOf({ subjectHint: 'Q3 deck' }, ['counterparty']), ['company.com'])).toBeNull();
    const silent = observationOf({}, ['counterparty']);
    expect(check(claimOf({ counterparty: 'Priya' }), ['company.com'], silent)).toBeNull();
  });

  it("the assigned candidate's address is checked too; alone it makes the outcome candidate-dependent", () => {
    const name = claimOf({ counterparty: 'Priya' });
    expect(check(name, ['company.com'], observationOf())).toEqual({ value: false, candidateOnly: false });
    const outsider = observationOf({ counterparty: 'priya@vendor.example' });
    expect(check(name, ['company.com'], outsider)).toEqual({ value: true, candidateOnly: true });
    expect(check(claimOf(), ['company.com'], outsider)).toEqual({ value: true, candidateOnly: true });
    const both = claimOf({ counterparty: 'lee@vendor.example' });
    expect(check(both, ['company.com'], outsider)).toEqual({ value: true, candidateOnly: false });
  });

  it('reads the candidate through email(): a display name never decides', () => {
    const spoof = observationOf({ counterparty: '"priya@company.com" <attacker@evil.example>' });
    expect(check(claimOf({ counterparty: 'Priya' }), ['company.com'], spoof)?.value).toBe(true);
  });

  it('no known address at all: a candidate whose counterparty email() cannot read counts as none (v1.4)', () => {
    const unreadable = observationOf({ counterparty: 'Priya Sharma' });
    expect(check(claimOf({ counterparty: 'Priya' }), ['company.com'], unreadable)).toBeNull();
    const ambiguous = observationOf({ counterparty: '<a@company.com>, <b@evil.example>' });
    expect(check(claimOf({ counterparty: 'Priya' }), ['company.com'], ambiguous)).toBeNull();
    expect(check(claimOf({}, ['counterparty']), ['company.com'], unreadable)).toBeNull();
  });
});

describe('amountAboveCeiling (§6.1)', () => {
  const ceiling = grantOf({ spendCeilingCents: 5000, spendCurrency: 'USD' });
  const purchase = (over: Record<string, unknown>, omit: readonly string[] = []) =>
    claimOf({ type: 'purchase.made', counterparty: 'acme', ...over }, omit);

  it('is not applicable outside spend types, without a ceiling, or without any amount', () => {
    expect(amountAboveCeiling(claimOf({ amountCents: 9000, currency: 'USD' }), null, ceiling, P)).toBeNull();
    expect(
      amountAboveCeiling(purchase({ amountCents: 9000, currency: 'USD' }), null, grantOf(), P),
    ).toBeNull();
    expect(amountAboveCeiling(purchase({}), null, ceiling, P)).toBeNull();
  });

  it('claim amount above the ceiling: exceeded, claim-only; at the ceiling: false', () => {
    expect(amountAboveCeiling(purchase({ amountCents: 5001, currency: 'USD' }), null, ceiling, P)).toEqual({
      value: true,
      amountCents: 5001,
      ceilingCents: 5000,
      spendCurrency: 'USD',
      exceeded: true,
      claimOnly: true,
    });
    expect(amountAboveCeiling(purchase({ amountCents: 5000 }), null, ceiling, P)?.value).toBe(false);
  });

  it("the claim's own other currency: mismatch alone, claim-only, its amount not counted", () => {
    const check = amountAboveCeiling(purchase({ amountCents: 9000, currency: 'EUR' }), null, ceiling, P);
    expect(check).toMatchObject({ value: true, exceeded: false, mismatchCurrency: 'EUR', claimOnly: true });
    expect(check?.amountCents).toBeUndefined();
  });

  it('the guard needs an amount known in any currency: then it is true or false, never not applicable', () => {
    const receipt = (over: Record<string, unknown>, omit: readonly string[] = []) =>
      observationOf({ source: 'gmail.receipt', type: 'purchase.made', merchant: 'Acme', ...over }, [
        'counterparty',
        ...omit,
      ]);
    const noAmount = purchase({}, ['currency']);
    const foreign = amountAboveCeiling(noAmount, receipt({ amountCents: 900, currency: 'CAD' }), ceiling, P);
    expect(foreign).toMatchObject({
      value: true,
      exceeded: false,
      mismatchCurrency: 'CAD',
      claimOnly: false,
    });
    expect(foreign?.amountCents).toBeUndefined();
    const bare = amountAboveCeiling(noAmount, receipt({ amountCents: 9000 }, ['currency']), ceiling, P);
    expect(bare).toMatchObject({ value: false, exceeded: false, claimOnly: false });
    expect(bare?.amountCents).toBeUndefined();
    expect(amountAboveCeiling(noAmount, receipt({}, ['amountCents', 'currency']), ceiling, P)).toBeNull();
  });
});

describe('amountAboveCeiling: the assigned receipt (§6.1)', () => {
  const ceiling = grantOf({ spendCeilingCents: 5000, spendCurrency: 'USD' });
  const purchase = (over: Record<string, unknown>, omit: readonly string[] = []) =>
    claimOf({ type: 'purchase.made', counterparty: 'acme', ...over }, omit);
  const receipt = (over: Record<string, unknown>, omit: readonly string[] = []) =>
    observationOf({ source: 'gmail.receipt', type: 'purchase.made', merchant: 'Acme', ...over }, [
      'counterparty',
      ...omit,
    ]);

  it("the assigned receipt's amount counts in spendCurrency, and then the outcome waits for grace", () => {
    const check = amountAboveCeiling(
      purchase({ amountCents: 3000, currency: 'USD' }),
      receipt({ amountCents: 7000, currency: 'USD' }),
      ceiling,
      P,
    );
    expect(check).toMatchObject({ value: true, amountCents: 7000, exceeded: true, claimOnly: false });
    const only = amountAboveCeiling(
      purchase({}),
      receipt({ amountCents: 7000, currency: 'USD' }),
      ceiling,
      P,
    );
    expect(only).toMatchObject({ value: true, amountCents: 7000, claimOnly: false });
  });

  it("a receipt in another currency is a mismatch whatever the claim's currency; its amount is ignored", () => {
    const third = receipt({ amountCents: 9000, currency: 'CAD' });
    const check = amountAboveCeiling(purchase({ amountCents: 3000, currency: 'USD' }), third, ceiling, P);
    expect(check).toMatchObject({
      value: true,
      amountCents: 3000,
      exceeded: false,
      mismatchCurrency: 'CAD',
      claimOnly: false,
    });
    const both = amountAboveCeiling(purchase({ amountCents: 8000 }, ['currency']), third, ceiling, P);
    expect(both).toMatchObject({
      exceeded: true,
      amountCents: 8000,
      mismatchCurrency: 'CAD',
      claimOnly: true,
    });
  });

  it('a receipt without a currency neither counts nor mismatches', () => {
    const bare = receipt({ amountCents: 9000 }, ['currency']);
    expect(
      amountAboveCeiling(purchase({ amountCents: 3000, currency: 'USD' }), bare, ceiling, P)?.value,
    ).toBe(false);
  });
});

describe('cumulativeAboveCeiling (§6.1, §6.3)', () => {
  const ceiling = grantOf({ spendCeilingCents: 5000, spendCurrency: 'USD' });
  const purchase = (over: Record<string, unknown>) =>
    claimOf({ type: 'purchase.made', counterparty: 'acme', ...over });
  const check = (claim: Claim, priorSpendCents: number) =>
    cumulativeAboveCeiling(claim, ceiling, { priorSpendCents }, P);

  it('prior + amount > ceiling, strictly', () => {
    expect(check(purchase({ amountCents: 2000, currency: 'USD' }), 3000)?.value).toBe(false);
    expect(check(purchase({ amountCents: 2001, currency: 'USD' }), 3000)).toEqual({
      value: true,
      priorSpendCents: 3000,
      amountCents: 2001,
      ceilingCents: 5000,
    });
  });

  it('is exact past 2^53 (BigInt)', () => {
    const huge = Number.MAX_SAFE_INTEGER;
    expect(check(purchase({ amountCents: 0, currency: 'USD' }), huge)?.value).toBe(true);
  });

  it('is not applicable without a claim amount counted in spendCurrency, a ceiling, or a spend type', () => {
    expect(check(purchase({ amountCents: 2001, currency: 'EUR' }), 3000)).toBeNull();
    expect(check(purchase({ currency: 'USD' }), 3000)).toBeNull();
    expect(
      cumulativeAboveCeiling(
        purchase({ amountCents: 1, currency: 'USD' }),
        grantOf(),
        { priorSpendCents: 9 },
        P,
      ),
    ).toBeNull();
    expect(check(claimOf({ amountCents: 9000, currency: 'USD' }), 3000)).toBeNull();
  });

  it('counts a claim amount with no currency in spendCurrency, as amountAboveCeiling does (Hard Rule 5)', () => {
    const bare = purchase({ amountCents: 2001 });
    expect(check(bare, 3000)).toEqual({
      value: true,
      priorSpendCents: 3000,
      amountCents: 2001,
      ceilingCents: 5000,
    });
    expect(check(bare, 2999)?.value).toBe(false);
    expect(amountAboveCeiling(bare, null, ceiling, P)?.amountCents).toBe(2001);
  });
});

describe('claim-less conditions', () => {
  it('observedScopeExceedsDeclared: true iff the observed scope is not declared; n/a without a scope', () => {
    const grant = grantOf({ declaredScopes: ['gmail.send'] });
    expect(
      observedScopeExceedsDeclared(grant, { priorSpendCents: 0, scope: { observed: 'gmail.read' } }),
    ).toBe(true);
    expect(
      observedScopeExceedsDeclared(grant, { priorSpendCents: 0, scope: { observed: 'gmail.send' } }),
    ).toBe(false);
    expect(observedScopeExceedsDeclared(grant, { priorSpendCents: 0 })).toBeNull();
  });

  it('unaskedLikely: the attribution score ≥ threshold in basis points; n/a without attribution', () => {
    const attribution = (scoreBp: number) =>
      Attribution.parse({ agent: 'muse', scoreBp, signals: ['agentSessionActive', 'userIdle'] });
    expect(unaskedLikely({ priorSpendCents: 0, attribution: attribution(7000) }, P)).toBe(true);
    expect(unaskedLikely({ priorSpendCents: 0, attribution: attribution(4000) }, P)).toBe(false);
    expect(unaskedLikely({ priorSpendCents: 0 }, P)).toBeNull();
  });
});
