/**
 * docs/grading.md v1.3 §5.3, across random policies (fast-check, 1,000 runs): the loader and features()
 * together leave no claim that can be assigned without a weighted feature.
 *  - The loader accepts a policy exactly when an independent oracle says it should: every type with sources
 *    names at least one identity feature, every identity feature is listed for its type with weight > 0 and is not
 *    `timeProximity` (v1.11), every non-empty featuresByType list has a positive total weight, and the model's weight
 *    is below its cap (v1.19).
 *  - Under every policy it accepts, features() scores every assignable claim with an exact value in [0, 1]
 *    and never throws; a claim that is not assignable either scores or throws RatioError('zero_weight_sum').
 *  - Receipt signals are the §5.1 feature names plus `score`, and `cp.*` reasons come only from an address
 *    claim (§5.1 v1.3).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { type FeatureClaim, type FeatureObservation, features, isAssignable } from '../../src/core/features';
import { counterparty, instantMs, isoWithOffset } from '../../src/core/normalize';
import { loadPolicy, type Policy, PolicyError } from '../../src/core/policy';
import { compareRatio, RATIO_ONE, RATIO_ZERO, RatioError } from '../../src/core/ratio';
import { ActionType, ReceiptSignal } from '../../src/core/schema';
import { BASIS_POINTS, MS_PER_MINUTE } from '../../src/core/units';

const RUNS = { numRuns: 1_000 };
const BASE_MS = instantMs('2026-10-06T14:02:00-04:00');

type FeatureKey = keyof typeof defaultPolicyJson.features;
type TypeKey = keyof typeof defaultPolicyJson.featuresByType;
const FEATURES = Object.keys(defaultPolicyJson.features) as FeatureKey[];
const TYPES = Object.keys(defaultPolicyJson.featuresByType) as TypeKey[];

/** Weights in basis points: zero now and then, so the loader's weight rules are exercised both ways. */
const weightBp = fc.oneof(
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 12, arbitrary: fc.constantFrom(1, 2500, 10_000) },
);
const weightsArb = fc.record(
  Object.fromEntries(FEATURES.map((feature) => [feature, weightBp])) as Record<
    FeatureKey,
    fc.Arbitrary<number>
  >,
);

/**
 * An identity list per type: a subset of the type's listed features, empty now and then, and now and then one that
 * may name `timeProximity` (refused since v1.11), so the loader's identity rules are exercised both ways.
 */
const identityArb = fc.record(
  Object.fromEntries(
    TYPES.map((type) => {
      const listed: readonly string[] = defaultPolicyJson.featuresByType[type];
      const content = listed.filter((feature) => feature !== 'timeProximity');
      return [
        type,
        fc.oneof(
          { weight: 1, arbitrary: fc.constant<string[]>([]) },
          { weight: 1, arbitrary: fc.subarray([...listed], { minLength: Math.min(1, listed.length) }) },
          { weight: 48, arbitrary: fc.subarray(content, { minLength: Math.min(1, content.length) }) },
        ),
      ];
    }),
  ) as Record<TypeKey, fc.Arbitrary<string[]>>,
);

/** §5.3 v1.3 (and v1.11: time is never an identity feature) written out directly from the contract, without the loader. */
function oracleAccepts(bp: Record<FeatureKey, number>, identity: Record<TypeKey, string[]>): boolean {
  const weights = new Map<string, number>(Object.entries(bp));
  const weightOf = (feature: string): number => weights.get(feature) ?? 0;
  return (
    TYPES.every((type) => {
      const listed: readonly string[] = defaultPolicyJson.featuresByType[type];
      const hasSources = defaultPolicyJson.sourcesByType[type].length > 0;
      const total = listed.reduce((sum, feature) => sum + weightOf(feature), 0);
      if (listed.length > 0 && total === 0) return false;
      if (hasSources && identity[type].length === 0) return false;
      return identity[type].every(
        (feature) => listed.includes(feature) && weightOf(feature) > 0 && feature !== 'timeProximity',
      );
    }) && modelBelowCap(weightOf('modelScore'))
  );
}

/** §5.4 (v1.19): the model's weight λ stays below (verified − partial) / (1 − partial), in basis points. */
function modelBelowCap(modelBp: number): boolean {
  const partial = Math.round(defaultPolicyJson.thresholds.partial * BASIS_POINTS);
  const verified = Math.round(defaultPolicyJson.thresholds.verified * BASIS_POINTS);
  return modelBp * (BASIS_POINTS - partial) < (verified - partial) * BASIS_POINTS;
}

function load(bp: Record<FeatureKey, number>, identity: Record<TypeKey, string[]>): Policy | null {
  const features = Object.fromEntries(FEATURES.map((feature) => [feature, bp[feature] / BASIS_POINTS]));
  try {
    return loadPolicy({ ...defaultPolicyJson, features, identityFeatures: identity });
  } catch (error) {
    if (error instanceof PolicyError) return null;
    throw error;
  }
}

const near = (rangeMs: number) =>
  fc.integer({ min: -rangeMs, max: rangeMs }).map((delta) => isoWithOffset(BASE_MS + delta, -240));

const PARTIES = ['priya@company.com', 'priya+x@company.com', 'prıya@company.com', 'Priya', 'acme store'];
const subject = fc.constantFrom('', 'q3 deck', 'the', 'budget');

const claimArb: fc.Arbitrary<FeatureClaim> = fc.record(
  {
    type: fc.constantFrom(...ActionType.options),
    claimedAt: near(MS_PER_MINUTE),
    claimedAtPrecision: fc.constant('minute' as const),
    counterparty: fc.constantFrom(...PARTIES),
    subjectHint: subject,
    targetAt: near(MS_PER_MINUTE * 60),
    amountCents: fc.constantFrom(0, 3000),
    currency: fc.constantFrom('USD', 'CAD'),
  },
  { requiredKeys: ['type', 'claimedAt', 'claimedAtPrecision'] },
);

const observationArb: fc.Arbitrary<FeatureObservation> = fc.record(
  {
    occurredAt: near(MS_PER_MINUTE * 50),
    counterparty: fc.constantFrom(...PARTIES, 'prıya+x@company.com'),
    merchant: fc.constantFrom('Acme', 'Acme Store'),
    subjectHint: subject,
    amountCents: fc.constantFrom(0, 3000),
    currency: fc.constantFrom('USD', 'CAD'),
  },
  { requiredKeys: ['occurredAt'] },
);

const SIGNALS: ReadonlySet<string> = new Set(ReceiptSignal.options);
const tally = { loaded: 0, rejected: 0, assignable: 0, thrown: 0 };

describe('loader and features() together (§5.3 v1.3, property)', () => {
  it('the loader accepts exactly the oracle policies, and under them no assignable claim meets Σw = 0', () => {
    fc.assert(
      fc.property(weightsArb, identityArb, claimArb, observationArb, (bp, identity, claim, observation) => {
        const policy = load(bp, identity);
        expect(policy !== null).toBe(oracleAccepts(bp, identity));
        if (policy === null) {
          tally.rejected += 1;
          return;
        }
        tally.loaded += 1;
        if (isAssignable(claim, policy)) {
          tally.assignable += 1;
          const { score, signals, reasonCodes } = features(claim, observation, policy);
          expect(compareRatio(score, RATIO_ZERO)).toBeGreaterThanOrEqual(0);
          expect(compareRatio(score, RATIO_ONE)).toBeLessThanOrEqual(0);
          expect(Object.keys(signals).every((key) => SIGNALS.has(key))).toBe(true);
          if (reasonCodes.length > 0) expect(counterparty(claim.counterparty)?.kind).toBe('address');
          return;
        }
        try {
          features(claim, observation, policy);
        } catch (error) {
          tally.thrown += 1;
          expect(error).toBeInstanceOf(RatioError);
          expect(error).toMatchObject({ code: 'zero_weight_sum' });
        }
      }),
      RUNS,
    );
    // Not vacuous: both loader outcomes, assignable claims and the fail-loud path all occurred.
    expect(tally.loaded).toBeGreaterThan(200);
    expect(tally.rejected).toBeGreaterThan(200);
    expect(tally.assignable).toBeGreaterThan(100);
    expect(tally.thrown).toBeGreaterThan(30);
  });
});
