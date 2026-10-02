/**
 * §8 finality of an OVER_SCOPE outcome, through `grade()` (docs/grading.md §6.1, §8):
 *  - "OVER_SCOPE from claim-only facts (type, claim amount, claim address, cumulative, observed scope)":
 *    immediately;
 *  - "OVER_SCOPE that depended on the assigned candidate (the outcome would not be OVER_SCOPE without that
 *    candidate's amount, currency or address)": like PARTIAL, `graceElapsed`.
 * The test is counterfactual: a candidate-based rule that matched first does not make the outcome wait when the
 * claim alone (here its cumulative spend) would still be OVER_SCOPE.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { grade } from '../../../src/core/grade';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { type Claim, type Observation, Receipt } from '../../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, PolicyView } from '../../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../../golden/scenario-schema';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
/** Before grace: a PARTIAL-like outcome needs a sync ≥ end(14:03) + afterClaimMin = 14:48. */
const EVAL = at('14:30');
const VIEW = PolicyView.parse(defaultPolicyJson);
const CEILING = buildGrant({ agent: 'muse', spendCeilingCents: 5_000, spendCurrency: 'USD' }, EVAL);
const COVERAGE = buildCoverage(
  [
    {
      source: 'gmail.receipt',
      lastSyncAt: EVAL,
      windowStart: at('12:00'),
      windowEnd: EVAL,
      accountHash: 'acct-a',
    },
  ],
  EVAL,
);

/** A $30 purchase of `acme` at 14:02. */
const PURCHASE: Claim = buildClaim(
  ScenarioClaim.parse({
    ref: 'c1',
    agent: 'muse',
    type: 'purchase.made',
    counterparty: 'acme',
    amountCents: 3_000,
    currency: 'USD',
    claimedAt: at('14:02'),
  }),
);

/** An Acme receipt at 14:02 (assigned to PURCHASE: time and merchant match, 9/14 ≥ partial). */
function receipt(amountCents: number, currency: string): Observation {
  const row = {
    ref: 'o1',
    source: 'gmail.receipt',
    type: 'purchase.made',
    merchant: 'Acme',
    amountCents,
    currency,
    occurredAt: at('14:02'),
    observedAt: at('14:10'),
  };
  return buildObservation(ScenarioObservation.parse(row), [], EVAL, VIEW);
}

function run(candidate: Observation, priorSpendCents: number, policy = DEFAULT_POLICY): Receipt {
  return Receipt.parse(grade(PURCHASE, [candidate], CEILING, policy, COVERAGE, { priorSpendCents }));
}

const outcome = (r: Receipt) => [r.grade, r.ruleId, r.state, r.reasons.map((reason) => reason.code)];

describe('§8: an OVER_SCOPE that rests on the assigned candidate waits only if the claim alone would not', () => {
  it('the receipt alone is over the ceiling: waits for grace (PENDING)', () => {
    for (const prior of [0, 2_000]) {
      // 2,000 + 3,000 = 5,000 is not over 5,000: the claim alone is within the ceiling.
      expect(outcome(run(receipt(8_000, 'USD'), prior))).toEqual([
        'OVER_SCOPE',
        'over_ceiling',
        'PENDING',
        ['ceiling.exceeded', 'match.best'],
      ]);
    }
  });

  it('the claim’s cumulative spend is over the ceiling too: FINAL at once, still by the first matching rule', () => {
    // 2,001 + 3,000 > 5,000: without the receipt, over_ceiling_cumulative holds, a claim-only fact.
    const r = run(receipt(8_000, 'USD'), 2_001);
    expect(outcome(r)).toEqual(['OVER_SCOPE', 'over_ceiling', 'FINAL', ['ceiling.exceeded', 'match.best']]);
    expect(r.finalAt).toBe(EVAL);
  });

  it('the receipt’s currency mismatches: the same counterfactual decides', () => {
    expect(outcome(run(receipt(3_000, 'CAD'), 0))[2]).toBe('PENDING');
    expect(outcome(run(receipt(3_000, 'CAD'), 2_001))[2]).toBe('FINAL');
  });

  it('without the candidate the outcome must still be OVER_SCOPE: a rule other than OVER_SCOPE first means wait', () => {
    // A policy that checks coverage before cumulative spend: with no candidate, no_coverage (UNVERIFIABLE) would
    // not match here (the window is partly seen), but pending would, before over_ceiling_cumulative.
    const policy = loadPolicy({
      ...defaultPolicyJson,
      rules: [
        { id: 'over_ceiling', when: { amountAboveCeiling: true }, then: 'OVER_SCOPE' },
        { id: 'pending', when: { graceElapsed: false }, then: 'PENDING' },
        { id: 'over_ceiling_cumulative', when: { cumulativeAboveCeiling: true }, then: 'OVER_SCOPE' },
      ],
    });
    expect(outcome(run(receipt(8_000, 'USD'), 2_001, policy))[2]).toBe('PENDING');
  });
});
