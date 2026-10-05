/**
 * Task 1.4: applicability, identity and the exact score (docs/grading.md §5.2, §5.3). Applicability reads the
 * claim alone; underspecified claims are never matched on time alone; the score is the exact weighted mean
 * over the policy's basis-point weights, so changing a weight in the policy document changes the score with
 * no code change.
 */
import { describe, expect, it } from 'vitest';

import {
  applicableFeatures,
  type FeatureClaim,
  type FeatureObservation,
  features,
  isAssignable,
  isUnderspecified,
} from '../../../src/core/features';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { type Ratio, RatioError, ratioGteBasisPoints } from '../../../src/core/ratio';
import defaultPolicyJson from '../../../../policy/default.json';

const text = (value: Ratio): string => `${value.num}/${value.den}`;
const AT = '2026-10-06T14:02:00-04:00';

const claim = (fields: Partial<FeatureClaim> & Pick<FeatureClaim, 'type'>): FeatureClaim => ({
  claimedAt: AT,
  claimedAtPrecision: 'minute',
  ...fields,
});
const observation = (fields: Partial<FeatureObservation> = {}): FeatureObservation => ({
  occurredAt: AT,
  ...fields,
});

/** A policy document patched at the top level, loaded (and validated) exactly as a shipped one would be. */
function patched(patch: Record<string, unknown>): Policy {
  return loadPolicy({ ...defaultPolicyJson, ...patch });
}

const EMAIL = 'email.sent' as const;
const TARGET = '2026-10-09T14:00:00-04:00';

/** [label, claim, applicable features]. */
const APPLICABLE_ROWS: readonly (readonly [string, FeatureClaim, readonly string[]])[] = [
  [
    'email to an address, with a subject',
    claim({ type: EMAIL, counterparty: 'priya@company.com', subjectHint: 'Q3 deck' }),
    ['timeProximity', 'counterpartyExact', 'counterpartyDomain', 'subjectOverlap'],
  ],
  [
    'email to a display-name form (the address is used)',
    claim({ type: EMAIL, counterparty: 'Priya <priya@company.com>' }),
    ['timeProximity', 'counterpartyExact', 'counterpartyDomain'],
  ],
  [
    'email to a name',
    claim({ type: EMAIL, counterparty: 'Priya Kumar' }),
    ['timeProximity', 'counterpartyName'],
  ],
  ['email to a name with no tokens', claim({ type: EMAIL, counterparty: '\u{1F600}' }), ['timeProximity']],
  ['email to a broken address', claim({ type: EMAIL, counterparty: 'priya@' }), ['timeProximity']],
  [
    'email to a name with a bidi override',
    claim({ type: EMAIL, counterparty: '\u202Eayirp' }),
    ['timeProximity'],
  ],
  ['email with a stop-word-only subject', claim({ type: EMAIL, subjectHint: 'Re: the' }), ['timeProximity']],
  ['email with nothing but a time', claim({ type: EMAIL }), ['timeProximity']],
  [
    'calendar with a target and a subject',
    claim({ type: 'calendar.created', subjectHint: 'Q3 review', targetAt: TARGET }),
    ['timeProximity', 'subjectOverlap'],
  ],
  [
    'calendar without a target',
    claim({ type: 'calendar.created', subjectHint: 'Q3 review' }),
    ['subjectOverlap'],
  ],
  [
    'calendar with an attendee address',
    claim({ type: 'calendar.deleted', counterparty: 'raj@company.com', targetAt: TARGET }),
    ['timeProximity', 'counterpartyExact', 'counterpartyDomain'],
  ],
  [
    'purchase with amount and merchant',
    claim({ type: 'purchase.made', counterparty: 'Acme', amountCents: 3000, currency: 'USD' }),
    ['timeProximity', 'amountExact', 'merchantMatch'],
  ],
  [
    'purchase with an amount and no currency',
    claim({ type: 'purchase.made', amountCents: 3000, subjectHint: 'Your order' }),
    ['timeProximity', 'amountExact', 'subjectOverlap'],
  ],
  ['message.sent lists no features', claim({ type: 'message.sent', counterparty: 'priya@company.com' }), []],
];

describe('applicableFeatures() reads the claim alone (§5.2)', () => {
  it.each(APPLICABLE_ROWS)('%s', (_label, value, expected) => {
    expect(applicableFeatures(value, DEFAULT_POLICY)).toEqual(expected);
  });

  it('keeps the policy order of featuresByType', () => {
    const reversed = patched({
      featuresByType: {
        ...defaultPolicyJson.featuresByType,
        [EMAIL]: [...defaultPolicyJson.featuresByType[EMAIL]].reverse(),
      },
    });
    const value = claim({ type: EMAIL, counterparty: 'priya@company.com', subjectHint: 'Q3 deck' });
    expect(applicableFeatures(value, reversed)).toEqual([
      'subjectOverlap',
      'counterpartyDomain',
      'counterpartyExact',
      'timeProximity',
    ]);
  });

  it('never applies modelScore (Sprint 5), even when a policy lists it', () => {
    const withModel = patched({
      featuresByType: {
        ...defaultPolicyJson.featuresByType,
        [EMAIL]: ['timeProximity', 'subjectOverlap', 'modelScore'],
      },
      identityFeatures: { ...defaultPolicyJson.identityFeatures, [EMAIL]: ['subjectOverlap'] },
    });
    expect(applicableFeatures(claim({ type: EMAIL, subjectHint: 'Q3 deck' }), withModel)).toEqual([
      'timeProximity',
      'subjectOverlap',
    ]);
  });
});

describe('isUnderspecified() and isAssignable() (§5.2, §4.3)', () => {
  it.each([
    ['"Done! I\'ve sent the email."', claim({ type: EMAIL }), true, false],
    ['an email with only a subject (golden 25)', claim({ type: EMAIL, subjectHint: 'Q3 deck' }), true, false],
    ['an email to a name', claim({ type: EMAIL, counterparty: 'Priya' }), false, true],
    ['an email to an address', claim({ type: EMAIL, counterparty: 'priya@company.com' }), false, true],
    [
      'a calendar claim with a subject and a target',
      claim({ type: 'calendar.created', subjectHint: 'Q3', targetAt: TARGET }),
      false,
      true,
    ],
    [
      'a calendar claim with a subject, no target (golden 26)',
      claim({ type: 'calendar.created', subjectHint: 'Q3' }),
      false,
      false,
    ],
    [
      'a calendar claim with only a target',
      claim({ type: 'calendar.updated', targetAt: TARGET }),
      true,
      false,
    ],
    ['a purchase with a merchant', claim({ type: 'purchase.made', counterparty: 'Acme' }), false, true],
    [
      'a purchase with an amount',
      claim({ type: 'purchase.made', amountCents: 500, currency: 'USD' }),
      false,
      true,
    ],
    ['a purchase with neither', claim({ type: 'purchase.made', subjectHint: 'Order' }), true, false],
    [
      'message.sent (no identity list, no sources)',
      claim({ type: 'message.sent', counterparty: 'Priya' }),
      false,
      false,
    ],
    ['other (no identity list, no sources)', claim({ type: 'other' }), false, false],
  ] as const)('%s: underspecified %s, assignable %s', (_label, value, underspecified, assignable) => {
    expect(isUnderspecified(value, DEFAULT_POLICY)).toBe(underspecified);
    expect(isAssignable(value, DEFAULT_POLICY)).toBe(assignable);
  });

  it('a type whose policy lists no sources is never assignable', () => {
    const noSources = patched({ sourcesByType: { ...defaultPolicyJson.sourcesByType, [EMAIL]: [] } });
    expect(isAssignable(claim({ type: EMAIL, counterparty: 'priya@company.com' }), noSources)).toBe(false);
  });

  it('reads the identity list from the policy', () => {
    const subjectIdentifies = patched({
      identityFeatures: { ...defaultPolicyJson.identityFeatures, [EMAIL]: ['subjectOverlap'] },
    });
    const subjectOnly = claim({ type: EMAIL, subjectHint: 'Q3 deck' });
    expect(isUnderspecified(subjectOnly, subjectIdentifies)).toBe(false);
    expect(
      isUnderspecified(claim({ type: EMAIL, counterparty: 'priya@company.com' }), subjectIdentifies),
    ).toBe(true);
  });
});

const DOMAIN_CLAIM = claim({ type: EMAIL, counterparty: 'priya@company.com', subjectHint: 'Q3 deck' });
const DOMAIN_OBSERVATION = observation({ counterparty: 'raj@company.com', subjectHint: 'Q3 budget' });

describe('features(): the exact score (§5.3)', () => {
  it("'domain match, subject J = 1/3' is exactly 1/2, which meets thresholds.partial", () => {
    const result = features(DOMAIN_CLAIM, DOMAIN_OBSERVATION, DEFAULT_POLICY);
    expect(text(result.score)).toBe('1/2');
    expect(ratioGteBasisPoints(result.score, DEFAULT_POLICY.bp.thresholds.partial)).toBe(true);
    expect(result.signals).toEqual({
      timeProximity: 1,
      counterpartyExact: 0,
      counterpartyDomain: 1,
      subjectOverlap: 0.3333,
      score: 0.5,
    });
    expect(result.reasonCodes).toEqual([]);
  });

  it('changing weights in the policy document changes the score, with no code change', () => {
    const heavierSubject = patched({ features: { ...defaultPolicyJson.features, subjectOverlap: 0.3 } });
    expect(text(features(DOMAIN_CLAIM, DOMAIN_OBSERVATION, heavierSubject).score)).toBe('10/21');
    const noDomain = patched({ features: { ...defaultPolicyJson.features, counterpartyDomain: 0 } });
    const result = features(DOMAIN_CLAIM, DOMAIN_OBSERVATION, noDomain);
    expect(text(result.score)).toBe('2/5');
    expect(ratioGteBasisPoints(result.score, noDomain.bp.thresholds.partial)).toBe(false);
  });

  it('changing the stop words in the policy changes the score', () => {
    const value = claim({ type: EMAIL, counterparty: 'priya@company.com', subjectHint: 'Deck' });
    const seen = observation({ counterparty: 'priya@company.com', subjectHint: 'The deck' });
    expect(text(features(value, seen, DEFAULT_POLICY).score)).toBe('1/1');
    const noStopWords = patched({ normalize: { stopWords: [] } });
    expect(text(features(value, seen, noStopWords).score)).toBe('11/12');
  });
});

describe('features(): scores of particular pairs', () => {
  it('a display-name spoof scores 8/13 against a name claim: PARTIAL at most (golden 19)', () => {
    const result = features(
      claim({ type: EMAIL, counterparty: 'Priya', subjectHint: 'Q3 deck' }),
      observation({ counterparty: '"Priya" <attacker@evil.example>', subjectHint: 'Q3 deck' }),
      DEFAULT_POLICY,
    );
    expect(text(result.score)).toBe('8/13');
    expect(ratioGteBasisPoints(result.score, DEFAULT_POLICY.bp.thresholds.verified)).toBe(false);
  });

  it('a purchase: merchant Jaccard and amount without currency (golden 63 c1)', () => {
    const result = features(
      claim({ type: 'purchase.made', counterparty: 'acme store', amountCents: 3000, currency: 'USD' }),
      observation({ merchant: 'Acme', amountCents: 3000 }),
      DEFAULT_POLICY,
    );
    expect(text(result.score)).toBe('1/2');
    expect(result.signals).toEqual({ timeProximity: 1, amountExact: 0, merchantMatch: 0.5, score: 0.5 });
  });

  it('an observation with nothing but a time scores 0: no evidence on time alone (§5.3 content gate, v1.11)', () => {
    const result = features(DOMAIN_CLAIM, observation(), DEFAULT_POLICY);
    expect(text(result.score)).toBe('0/1');
    // The features are still shown as valued; only the score is 0 (the weighted mean alone is 2500/9000 = 5/18).
    expect(result.signals).toEqual({
      timeProximity: 1,
      counterpartyExact: 0,
      counterpartyDomain: 0,
      subjectOverlap: 0,
      score: 0,
    });
  });

  it('signals hold only the applicable features and the score', () => {
    const result = features(claim({ type: EMAIL, counterparty: 'Priya' }), observation(), DEFAULT_POLICY);
    expect(Object.keys(result.signals).sort()).toEqual(['counterpartyName', 'score', 'timeProximity']);
  });

  it('throws a typed error rather than inventing a score when no applicable feature has weight', () => {
    expect(() => features(claim({ type: 'message.sent' }), observation(), DEFAULT_POLICY)).toThrow(
      RatioError,
    );
    const timeless = patched({ features: { ...defaultPolicyJson.features, timeProximity: 0 } });
    expect(() => features(claim({ type: EMAIL }), observation(), timeless)).toThrow(RatioError);
  });
});
