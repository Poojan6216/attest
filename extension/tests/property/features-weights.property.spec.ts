/**
 * Task 1.4 properties under RANDOM policy weights (fast-check, 1,000 runs each), added by the 1.4 verifier.
 * The other property file uses the shipped weights; these vary every weight over basis-point multiples
 * (0.0001 steps, awkward denominators included) and every featuresByType order:
 *  - the score is a weighted mean in [0, 1] whatever the weights;
 *  - it is exactly linear in the weights: S(w + w′)·Σ(w + w′) = S(w)·Σw + S(w′)·Σw′ over the applicable
 *    features (a score that read decimal weights, renormalised over features that do not apply, or depended
 *    on list order would break this), and scaling every weight leaves it unchanged;
 *  - shuffling featuresByType never changes it, at any weights.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  applicableFeatures,
  type FeatureClaim,
  type FeatureObservation,
  features,
} from '../../src/core/features';
import { instantMs, isoWithOffset } from '../../src/core/normalize';
import { loadPolicy, type Policy } from '../../src/core/policy';
import { compareRatio, RATIO_ONE, RATIO_ZERO, type Ratio } from '../../src/core/ratio';
import { BASIS_POINTS, MS_PER_DAY, MS_PER_MINUTE } from '../../src/core/units';
import defaultPolicyJson from '../../../policy/default.json';

const RUNS = { numRuns: 1_000 };
const BASE_MS = instantMs('2026-10-06T14:02:00-04:00');

const near = (rangeMs: number) =>
  fc.integer({ min: -rangeMs, max: rangeMs }).map((delta) => isoWithOffset(BASE_MS + delta, -240));

const TYPES = ['email.sent', 'calendar.updated', 'purchase.made'] as const;
const PARTIES = [
  'priya@company.com',
  'raj@company.com',
  'priya+x@gmail.com',
  'priya@gmail.com',
  'pr\u0131ya@company.com',
  'Priya',
  'Priya Kumar',
  'acme store',
];
const subject = fc
  .array(fc.constantFrom('q3', 'deck', 'budget', 'the', 'invoice'), { maxLength: 3 })
  .map((words) => words.join(' '));

const claimArb: fc.Arbitrary<FeatureClaim> = fc.record(
  {
    type: fc.constantFrom(...TYPES),
    claimedAt: near(MS_PER_MINUTE),
    claimedAtPrecision: fc.constantFrom('minute', 'hour'),
    counterparty: fc.constantFrom(...PARTIES),
    subjectHint: subject,
    targetAt: near(MS_PER_DAY),
    amountCents: fc.constantFrom(3000, 8000),
    currency: fc.constantFrom('USD', 'CAD'),
  },
  { requiredKeys: ['type', 'claimedAt', 'claimedAtPrecision'] },
);

const observationArb: fc.Arbitrary<FeatureObservation> = fc.record(
  {
    occurredAt: near(MS_PER_MINUTE * 50),
    counterparty: fc.constantFrom(...PARTIES, 'priya.kumar@company.com'),
    merchant: fc.constantFrom('Acme', 'Acme Store'),
    subjectHint: subject,
    amountCents: fc.constantFrom(3000, 8000),
    currency: fc.constantFrom('USD', 'CAD'),
  },
  { requiredKeys: ['occurredAt'] },
);

type Weights = Record<keyof typeof defaultPolicyJson.features, number>;
/** At most half of 10,000 bp, so the sum of two weight vectors is still a valid weight. */
const HALF = BASIS_POINTS / 2;
const identityBp = fc.integer({ min: 1, max: HALF });
const anyBp = fc.integer({ min: 0, max: HALF });
/** Basis-point weights; identity features stay above 0, as the loader requires (§5.3). */
const weightsArb: fc.Arbitrary<Weights> = fc.record({
  timeProximity: anyBp,
  counterpartyExact: identityBp,
  counterpartyDomain: anyBp,
  counterpartyName: identityBp,
  subjectOverlap: identityBp,
  amountExact: identityBp,
  merchantMatch: identityBp,
  modelScore: fc.constant(0),
});

/** featuresByType as a document holds it: one feature-name list per type. */
type PerType = Record<keyof typeof defaultPolicyJson.featuresByType, string[]>;
const shuffledLists: fc.Arbitrary<PerType> = fc.record(
  Object.fromEntries(
    Object.entries(defaultPolicyJson.featuresByType).map(([type, list]) => [
      type,
      fc.shuffledSubarray(list, { minLength: list.length }),
    ]),
  ) as { [Type in keyof PerType]: fc.Arbitrary<string[]> },
);

function policyOf(bp: Weights, featuresByType: PerType = defaultPolicyJson.featuresByType): Policy {
  const features = Object.fromEntries(Object.entries(bp).map(([key, value]) => [key, value / BASIS_POINTS]));
  return loadPolicy({ ...defaultPolicyJson, features, featuresByType });
}

function add(a: Weights, b: Weights): Weights {
  const sum = { ...a };
  for (const key of Object.keys(sum) as (keyof Weights)[]) sum[key] = a[key] + b[key];
  return sum;
}

/** Σ wᵢ over the claim's applicable features, as a BigInt. */
function applicableWeight(claim: FeatureClaim, policy: Policy): bigint {
  return applicableFeatures(claim, policy).reduce((sum, name) => sum + BigInt(policy.bp.features[name]), 0n);
}

/** S·Σw as an unreduced fraction. */
function weighted(score: Ratio, total: bigint): Ratio {
  return { num: score.num * total, den: score.den };
}

function plus(a: Ratio, b: Ratio): Ratio {
  return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}

describe('features() under random basis-point weights', () => {
  it('the score is in [0, 1] and unchanged by shuffling featuresByType', () => {
    fc.assert(
      fc.property(claimArb, observationArb, weightsArb, shuffledLists, (claim, observation, w, lists) => {
        const policy = policyOf(w);
        if (applicableWeight(claim, policy) === 0n) return;
        const score = features(claim, observation, policy).score;
        expect(compareRatio(score, RATIO_ZERO)).toBeGreaterThanOrEqual(0);
        expect(compareRatio(score, RATIO_ONE)).toBeLessThanOrEqual(0);
        expect(features(claim, observation, policyOf(w, lists)).score).toEqual(score);
      }),
      RUNS,
    );
  });
});

describe('features() is exactly linear in the policy weights', () => {
  it('is exactly linear in the weights: S(w+v)·Σ(w+v) = S(w)·Σw + S(v)·Σv', () => {
    fc.assert(
      fc.property(
        claimArb,
        observationArb,
        weightsArb,
        weightsArb,
        shuffledLists,
        (claim, obs, w, v, lists) => {
          const [pw, pv, pSum] = [policyOf(w), policyOf(v, lists), policyOf(add(w, v))];
          const [tw, tv, tSum] = [pw, pv, pSum].map((policy) => applicableWeight(claim, policy));
          if (tw === undefined || tv === undefined || tSum === undefined) throw new Error('three totals');
          if (tw === 0n || tv === 0n) return;
          const lhs = weighted(features(claim, obs, pSum).score, tSum);
          const rhs = plus(
            weighted(features(claim, obs, pw).score, tw),
            weighted(features(claim, obs, pv).score, tv),
          );
          expect(compareRatio(lhs, rhs)).toBe(0);
        },
      ),
      RUNS,
    );
  });

  it('is unchanged when every weight is doubled', () => {
    fc.assert(
      fc.property(claimArb, observationArb, weightsArb, (claim, observation, w) => {
        const policy = policyOf(w);
        if (applicableWeight(claim, policy) === 0n) return;
        expect(features(claim, observation, policyOf(add(w, w))).score).toEqual(
          features(claim, observation, policy).score,
        );
      }),
      RUNS,
    );
  });
});
