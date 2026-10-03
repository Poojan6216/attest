/**
 * Task 1.4 properties (fast-check, ≥ 1,000 runs each) for match features (docs/grading.md §5):
 *  - the score is always an exact rational in [0, 1], and every display signal is in [0, 1];
 *  - the score does not depend on the order of featuresByType lists or on the policy's key order (exact);
 *  - a missing or emptied observation field never raises the score (§5.2: applicability is the claim's);
 *  - counterpartyExact is 1 exactly when the addresses are code-point identical after ASCII lowercasing, and
 *    a confusable pair that is not identical scores 0 on both address features with cp.confusable.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  applicableFeatures,
  type FeatureClaim,
  type FeatureObservation,
  features,
  isAssignable,
  isUnderspecified,
} from '../../src/core/features';
import { addressFeatures } from '../../src/core/features-counterparty';
import { asciiLower, email, type EmailAddress, instantMs, isoWithOffset } from '../../src/core/normalize';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../src/core/policy';
import { compareRatio, RATIO_ONE, RATIO_ZERO, RatioError } from '../../src/core/ratio';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../src/core/units';
import defaultPolicyJson from '../../../policy/default.json';

const RUNS = { numRuns: 1_000 };
const BASE_MS = instantMs('2026-10-06T14:02:00-04:00');
const OFFSETS = [-420, -240, 0, 330, 840];

const instant = (rangeMs: number) =>
  fc
    .tuple(fc.integer({ min: -rangeMs, max: rangeMs }), fc.constantFrom(...OFFSETS))
    .map(([delta, offset]) => isoWithOffset(BASE_MS + delta, offset));
/** Mostly near the claim (where scores are interesting), sometimes days away. */
const iso = fc.oneof(instant(MS_PER_MINUTE * 50), instant(MS_PER_DAY * 4));

const ADDRESSES = [
  'priya@company.com',
  'Priya@Company.com',
  'raj@company.com',
  'priya+x@company.com',
  'priya@gmail.com',
  'raj@gmail.com',
  'pr\u0131ya@company.com',
  'jos\u00E9@company.com',
  'jose\u0301@company.com',
  'priya@xn--mnchen-3ya.de',
  'priya.kumar@company.com',
  '"Priya" <attacker@evil.example>',
];
const NAMES = ['Priya', 'Priya Kumar', 'Jos\u00E9', 'Acme Store', 'acme', '\u{1F600}', 'priya@'];
const WORDS = ['q3', 'deck', 'budget', 'the', 're', 'invoice', 'Plan'];
const TYPES = [
  'email.sent',
  'calendar.created',
  'calendar.updated',
  'calendar.deleted',
  'purchase.made',
  'subscription.changed',
  'listing.posted',
  'message.sent',
  'other',
] as const;

const subject = fc.array(fc.constantFrom(...WORDS), { maxLength: 4 }).map((words) => words.join(' '));
const money = {
  amountCents: fc.constantFrom(0, 3000, 8000),
  currency: fc.constantFrom('USD', 'CAD'),
};

const claimArb: fc.Arbitrary<FeatureClaim> = fc.record(
  {
    type: fc.constantFrom(...TYPES),
    claimedAt: instant(MS_PER_MINUTE * 5),
    claimedAtPrecision: fc.constantFrom('minute', 'hour', 'day'),
    counterparty: fc.constantFrom(...ADDRESSES, ...NAMES),
    subjectHint: subject,
    targetAt: instant(MS_PER_DAY),
    ...money,
  },
  { requiredKeys: ['type', 'claimedAt', 'claimedAtPrecision'] },
);

const observationArb: fc.Arbitrary<FeatureObservation> = fc.record(
  {
    occurredAt: iso,
    counterparty: fc.constantFrom(...ADDRESSES, ...NAMES),
    merchant: fc.constantFrom('Acme', 'Acme Store', 'acme store', 'Globex'),
    subjectHint: subject,
    ...money,
  },
  { requiredKeys: ['occurredAt'] },
);

function totalWeight(claim: FeatureClaim, policy: Policy): number {
  return applicableFeatures(claim, policy).reduce((sum, feature) => sum + policy.bp.features[feature], 0);
}

/** Claims that have a score at all (some applicable feature has weight). */
const scorableClaim = claimArb.filter((claim) => totalWeight(claim, DEFAULT_POLICY) > 0);

describe('the score is an exact value in [0, 1]', () => {
  it('for every pair, or a typed error exactly when no applicable feature has weight', () => {
    fc.assert(
      fc.property(claimArb, observationArb, (claim, observation) => {
        if (totalWeight(claim, DEFAULT_POLICY) === 0) {
          expect(isAssignable(claim, DEFAULT_POLICY)).toBe(false);
          expect(() => features(claim, observation, DEFAULT_POLICY)).toThrow(RatioError);
          return;
        }
        const result = features(claim, observation, DEFAULT_POLICY);
        expect(compareRatio(result.score, RATIO_ZERO)).toBeGreaterThanOrEqual(0);
        expect(compareRatio(result.score, RATIO_ONE)).toBeLessThanOrEqual(0);
        for (const value of Object.values(result.signals)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
        expect(features(claim, observation, DEFAULT_POLICY)).toEqual(result);
      }),
      RUNS,
    );
  });
});

type PolicyDoc = typeof defaultPolicyJson;
type PerType = PolicyDoc['featuresByType'];

/** A full permutation of each type's feature and identity lists. */
const permutedLists = (lists: PerType) =>
  fc.record(
    Object.fromEntries(
      TYPES.map((type) => [type, fc.shuffledSubarray(lists[type], { minLength: lists[type].length })]),
    ) as { [Type in keyof PerType]: fc.Arbitrary<string[]> },
  );

/** The same document with every object's keys in an order decided by `ranks` (values unchanged). */
function reorderKeys(value: unknown, ranks: readonly number[], depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => reorderKeys(item, ranks, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const entries = Object.entries(value);
  const rank = (index: number): number => ranks[(index + depth) % ranks.length] ?? index;
  const order = entries.map((entry, index) => ({ entry, key: rank(index) })).sort((a, b) => a.key - b.key);
  return Object.fromEntries(
    order.map(({ entry: [key, child] }) => [key, reorderKeys(child, ranks, depth + 1)]),
  );
}

function expectSameScoring(claim: FeatureClaim, observation: FeatureObservation, policy: Policy): void {
  const expected = features(claim, observation, DEFAULT_POLICY);
  const actual = features(claim, observation, policy);
  expect(actual.score).toEqual(expected.score);
  expect(actual.signals).toEqual(expected.signals);
  expect(actual.reasonCodes).toEqual(expected.reasonCodes);
  expect(isUnderspecified(claim, policy)).toBe(isUnderspecified(claim, DEFAULT_POLICY));
  expect(isAssignable(claim, policy)).toBe(isAssignable(claim, DEFAULT_POLICY));
}

describe('the score is exact: no order of the policy can change it', () => {
  it('is independent of the order of featuresByType and identityFeatures lists', () => {
    fc.assert(
      fc.property(
        scorableClaim,
        observationArb,
        permutedLists(defaultPolicyJson.featuresByType),
        permutedLists(defaultPolicyJson.identityFeatures),
        (claim, observation, featuresByType, identityFeatures) => {
          const policy = loadPolicy({ ...defaultPolicyJson, featuresByType, identityFeatures });
          expectSameScoring(claim, observation, policy);
        },
      ),
      RUNS,
    );
  });

  it('is independent of the key order of the policy document', () => {
    fc.assert(
      fc.property(
        scorableClaim,
        observationArb,
        fc.array(fc.integer({ min: 0, max: 1_000 }), { minLength: 1, maxLength: 12 }),
        (claim, observation, ranks) => {
          const policy = loadPolicy(reorderKeys(defaultPolicyJson, ranks));
          expect(policy.policyHash).toBe(DEFAULT_POLICY.policyHash);
          expectSameScoring(claim, observation, policy);
        },
      ),
      RUNS,
    );
  });
});

const FIELDS = ['counterparty', 'merchant', 'subjectHint', 'amountCents', 'currency'] as const;
type Field = (typeof FIELDS)[number];

/** `observation` without the `drop` fields; with `empty`, string fields are kept but blanked instead. */
function strip(observation: FeatureObservation, drop: readonly Field[], empty: boolean): FeatureObservation {
  const keep = (key: Field): boolean => !drop.includes(key) && observation[key] !== undefined;
  const text = (key: 'counterparty' | 'merchant' | 'subjectHint') => {
    const value = observation[key];
    if (value === undefined) return {};
    if (keep(key)) return { [key]: value };
    return empty ? { [key]: '' } : {};
  };
  return {
    occurredAt: observation.occurredAt,
    ...text('counterparty'),
    ...text('merchant'),
    ...text('subjectHint'),
    ...(keep('amountCents') && observation.amountCents !== undefined
      ? { amountCents: observation.amountCents }
      : {}),
    ...(keep('currency') && observation.currency !== undefined ? { currency: observation.currency } : {}),
  };
}

describe('a missing observation field never raises the score (§5.2)', () => {
  it.each([
    ['removed', false],
    ['emptied', true],
  ] as const)('any set of fields %s', (_label, empty) => {
    fc.assert(
      fc.property(scorableClaim, observationArb, fc.subarray([...FIELDS]), (claim, observation, drop) => {
        const full = features(claim, observation, DEFAULT_POLICY).score;
        const partial = features(claim, strip(observation, drop, empty), DEFAULT_POLICY).score;
        expect(compareRatio(partial, full)).toBeLessThanOrEqual(0);
      }),
      RUNS,
    );
  });
});

const LOCAL = fc
  .array(fc.constantFrom('p', 'P', 'r', 'i', 'y', 'a', '\u0131', '\u212A', '\u00E9', 'e\u0301', '+', '.'), {
    minLength: 1,
    maxLength: 6,
  })
  .map((chars) => chars.join(''));
const DOMAIN = fc.constantFrom(
  'company.com',
  'Company.com',
  'gmail.com',
  'xn--mnchen-3ya.de',
  'c\u00F6mpany.com',
);
const ADDRESS: fc.Arbitrary<EmailAddress> = fc
  .tuple(LOCAL, DOMAIN)
  .map(([local, domain]) => email(`${local}@${domain}`))
  .filter((parsed): parsed is EmailAddress => parsed !== null);

describe('address features: identity is code points after ASCII lowercasing, never a fold', () => {
  it('counterpartyExact is 1 iff asciiLower-identical; a non-identical confusable pair is 0, cp.confusable', () => {
    fc.assert(
      fc.property(ADDRESS, ADDRESS, (claimed, observed) => {
        const result = addressFeatures(claimed, observed, DEFAULT_POLICY.commonDomains);
        const identical = asciiLower(claimed.address) === asciiLower(observed.address);
        expect(compareRatio(result.counterpartyExact, RATIO_ONE) === 0).toBe(identical);
        expect(compareRatio(result.counterpartyDomain, result.counterpartyExact)).toBeGreaterThanOrEqual(0);
        if (!identical && (claimed.confusable || observed.confusable)) {
          expect(result.counterpartyDomain).toEqual(RATIO_ZERO);
          expect(result.reason).toBe('cp.confusable');
        }
        if (identical) expect(result.reason === 'cp.non_ascii').toBe(claimed.confusable);
      }),
      { numRuns: 2_000 },
    );
  });
});
