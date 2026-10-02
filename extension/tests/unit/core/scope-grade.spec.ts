/**
 * Task 1.8 Done-when, end to end through grade() (docs/grading.md §6.1, §6.2, §6.3): type-not-allowed,
 * scope-not-declared, a single purchase over the ceiling, and the cumulative ceiling (two $30 purchases against
 * a $50 ceiling make the second OVER_SCOPE). scope.ts supplies `context.priorSpendCents` and the claim-less scope
 * subjects; grade() decides. Each receipt's reasons name the type, the scope (by hash) or the amounts, and
 * render as text with reason-text.ts.
 */
import { describe, expect, it } from 'vitest';

import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { grade } from '../../../src/core/grade';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { reasonText } from '../../../src/core/reason-text';
import {
  Activity,
  Claim,
  type ClaimInput,
  Coverage,
  Grant,
  type GrantInput,
  type Receipt,
} from '../../../src/core/schema';
import { priorSpendCents, scopeSubjects } from '../../../src/core/scope';

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
/** No observer coverage at all: the over-scope rules read only the claim and the grant (§6.2). */
const NO_COVERAGE = Coverage.parse({ evaluatedAt: EVALUATED_AT, observers: [] });

type ClaimFields = Pick<ClaimInput, 'type' | 'claimedAt'> & Partial<ClaimInput>;

function claimOf(fields: ClaimFields): Claim {
  const rawHash = sha256Hex(canonicalJson(fields));
  return Claim.parse({
    id: idFromHash(rawHash),
    agent: 'muse',
    claimedAtPrecision: 'minute',
    observedAt: fields.claimedAt,
    sourceKind: 'activity_view',
    extractor: { id: 'test', version: '1', confidence: 1 },
    rawHash,
    ...fields,
  } satisfies ClaimInput);
}

function grantOf(fields: Partial<GrantInput> = {}): Grant {
  return Grant.parse({
    agent: 'muse',
    allowedTypes: ['email.sent', 'purchase.made', 'subscription.changed'],
    counterpartyAllowlist: [],
    spendCeilingCents: null,
    declaredScopes: [],
    updatedAt: '2026-10-05T15:00:00-04:00',
    ...fields,
  } satisfies GrantInput);
}

const CEILING_GRANT = grantOf({ spendCeilingCents: 5_000, spendCurrency: 'USD' });
const purchase = (claimedAt: string, amountCents: number) =>
  claimOf({ type: 'purchase.made', counterparty: 'acme', amountCents, currency: 'USD', claimedAt });

describe('task 1.8 Done-when: OVER_SCOPE from the grant', () => {
  it('type not allowed: an email claim against a calendar-only grant is OVER_SCOPE (over_scope), FINAL', () => {
    const claim = claimOf({
      type: 'email.sent',
      counterparty: 'priya@company.com',
      claimedAt: '2026-10-06T14:02:00-04:00',
    });
    const grant = grantOf({ allowedTypes: ['calendar.created', 'calendar.updated', 'calendar.deleted'] });
    const receipt = grade(claim, [], grant, DEFAULT_POLICY, NO_COVERAGE, { priorSpendCents: 0 });
    expect(receipt.grade).toBe('OVER_SCOPE');
    expect(receipt.ruleId).toBe('over_scope');
    expect(receipt.state).toBe('FINAL');
    expect(receipt.reasons[0]).toEqual({ code: 'scope.type_not_allowed', params: { type: 'email.sent' } });
    expect(reasonText(receipt.reasons[0] ?? { code: '', params: {} })).toContain('(email.sent)');
  });

  it('scope not declared: each observed-but-undeclared scope is one OVER_SCOPE receipt (over_scope_observed)', () => {
    const grant = grantOf({
      declaredScopes: ['gmail.send', 'calendar.write'],
      observedScopes: ['gmail.send', 'gmail.read', 'calendar.write', 'payments'],
    });
    const subjects = scopeSubjects(grant);
    expect(subjects).toEqual(['gmail.read', 'payments']);
    for (const observed of subjects) {
      const receipt = grade(null, [], grant, DEFAULT_POLICY, NO_COVERAGE, {
        priorSpendCents: 0,
        scope: { observed },
      });
      expect(receipt.grade).toBe('OVER_SCOPE');
      expect(receipt.ruleId).toBe('over_scope_observed');
      expect(receipt.state).toBe('FINAL');
      expect(receipt.observationIds).toEqual([]);
      expect(receipt.reasons).toEqual([
        { code: 'scope.observed_not_declared', params: { scopeHash: sha256Hex(observed) } },
      ]);
      const text = reasonText(receipt.reasons[0] ?? { code: '', params: {} });
      expect(text).toContain(sha256Hex(observed));
      expect(text).not.toContain(observed);
    }
  });

  it('a declared scope is never OVER_SCOPE', () => {
    const grant = grantOf({ declaredScopes: ['gmail.send'], observedScopes: ['gmail.send'] });
    expect(scopeSubjects(grant)).toEqual([]);
    const receipt = grade(null, [], grant, DEFAULT_POLICY, NO_COVERAGE, {
      priorSpendCents: 0,
      scope: { observed: 'gmail.send' },
    });
    expect(receipt.grade).not.toBe('OVER_SCOPE');
  });
});

describe('task 1.8 Done-when: OVER_SCOPE from the spend ceiling', () => {
  it('single purchase over the ceiling: $200 against $50 is OVER_SCOPE (over_ceiling) with no receipt visible', () => {
    const claim = purchase('2026-10-06T14:02:00-04:00', 20_000);
    const prior = priorSpendCents(claim, [claim], DEFAULT_POLICY);
    expect(prior).toBe(0);
    const receipt = grade(claim, [], CEILING_GRANT, DEFAULT_POLICY, NO_COVERAGE, { priorSpendCents: prior });
    expect(receipt.grade).toBe('OVER_SCOPE');
    expect(receipt.ruleId).toBe('over_ceiling');
    expect(receipt.state).toBe('FINAL');
    expect(receipt.reasons[0]).toEqual({
      code: 'ceiling.exceeded',
      params: { amountCents: 20_000, ceilingCents: 5_000 },
    });
  });

  it('cumulative over the ceiling: two $30 purchases against $50, the second is OVER_SCOPE', () => {
    const first = purchase('2026-10-06T10:00:00-04:00', 3_000);
    const second = purchase('2026-10-06T11:00:00-04:00', 3_000);
    const claims = [first, second];

    const firstPrior = priorSpendCents(first, claims, DEFAULT_POLICY);
    const firstReceipt = grade(first, [], CEILING_GRANT, DEFAULT_POLICY, NO_COVERAGE, {
      priorSpendCents: firstPrior,
    });
    expect(firstPrior).toBe(0);
    expect(firstReceipt.grade).not.toBe('OVER_SCOPE');

    const secondPrior = priorSpendCents(second, claims, DEFAULT_POLICY);
    const secondReceipt = grade(second, [], CEILING_GRANT, DEFAULT_POLICY, NO_COVERAGE, {
      priorSpendCents: secondPrior,
    });
    expect(secondPrior).toBe(3_000);
    expect(secondReceipt.grade).toBe('OVER_SCOPE');
    expect(secondReceipt.ruleId).toBe('over_ceiling_cumulative');
    expect(secondReceipt.state).toBe('FINAL');
    expect(secondReceipt.reasons[0]).toEqual({
      code: 'ceiling.cumulative_exceeded',
      params: { priorSpendCents: 3_000, amountCents: 3_000, ceilingCents: 5_000 },
    });
    expect(reasonText(secondReceipt.reasons[0] ?? { code: '', params: {} })).toBe(
      'With 3000 claimed earlier in the spend window, 3000 more goes over the spend ceiling of 5000 (minor units).',
    );
  });

  it('the ceiling itself is allowed: $30 then $20 reaches $50 exactly and is not OVER_SCOPE', () => {
    const first = purchase('2026-10-06T10:00:00-04:00', 3_000);
    const second = purchase('2026-10-06T11:00:00-04:00', 2_000);
    const prior = priorSpendCents(second, [first, second], DEFAULT_POLICY);
    const receipt = grade(second, [], CEILING_GRANT, DEFAULT_POLICY, NO_COVERAGE, { priorSpendCents: prior });
    expect(prior + 2_000).toBe(5_000);
    expect(receipt.grade).not.toBe('OVER_SCOPE');
  });

  it('every reason on these receipts renders as text', () => {
    const claim = purchase('2026-10-06T14:02:00-04:00', 20_000);
    const receipt = grade(claim, [], CEILING_GRANT, DEFAULT_POLICY, NO_COVERAGE, { priorSpendCents: 0 });
    for (const reason of receipt.reasons) expect(reasonText(reason).length).toBeGreaterThan(0);
  });
});

describe('the spend ceiling through gradeBatch (§3: priorSpendCents reads activity.claims)', () => {
  const batch = (claims: readonly Claim[]) =>
    gradeBatch(
      claims,
      createMemoryIndex([], DEFAULT_POLICY.windows.afterClaimMin),
      [CEILING_GRANT],
      DEFAULT_POLICY,
      NO_COVERAGE,
      Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims }),
    );
  const ruleOf = (receipts: readonly Receipt[], claim: Claim) =>
    receipts.find((receipt) => receipt.claimId === claim.id)?.ruleId;

  it('two $30 purchases at one instant (written in two offsets): only the larger claim id goes over', async () => {
    const a = purchase('2026-10-06T10:00:00-04:00', 3_000);
    const b = purchase('2026-10-06T14:00:00Z', 3_000);
    expect(a.id).not.toBe(b.id);
    const [first, second] = a.id < b.id ? [a, b] : [b, a];
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const receipts = await batch(order);
      expect(ruleOf(receipts, first)).toBe('no_coverage');
      expect(ruleOf(receipts, second)).toBe('over_ceiling_cumulative');
    }
  });

  it('currencies never mix: an earlier EUR purchase does not push a USD purchase over a USD ceiling', async () => {
    const eur = claimOf({
      type: 'purchase.made',
      counterparty: 'acme',
      amountCents: 3_000,
      currency: 'EUR',
      claimedAt: '2026-10-06T10:00:00-04:00',
    });
    const usd = purchase('2026-10-06T11:00:00-04:00', 3_000);
    const receipts = await batch([eur, usd]);
    expect(ruleOf(receipts, eur)).toBe('over_ceiling');
    expect(ruleOf(receipts, usd)).toBe('no_coverage');
  });
});
