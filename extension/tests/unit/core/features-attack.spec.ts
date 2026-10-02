/**
 * Task 1.4, adversarial cases for features() (docs/grading.md §5, §11), added by the 1.4 verifier:
 *  - exactness under awkward basis-point weights, including one where a floating-point sum lands below a
 *    threshold the exact score meets;
 *  - every confusable family through features(), on either side of the pair, never matching unless identical;
 *  - +tags on free mail: PARTIAL at most, never VERIFIED;
 *  - display-name spoofs: the address inside the angle brackets is the only thing compared;
 *  - claims whose name or subject has no tokens: the feature is not applicable, so the claim cannot be
 *    matched on time alone; an observation with no tokens scores 0 instead of dropping the feature;
 *  - a policy that leaves an assignable claim no weighted feature: never a made-up score.
 * Every non-ASCII input is a \u escape (Decisions [1.1]).
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
import { DEFAULT_POLICY, loadPolicy, type Policy, PolicyError } from '../../../src/core/policy';
import { type Ratio, RatioError, ratioGteBasisPoints } from '../../../src/core/ratio';
import defaultPolicyJson from '../../../../policy/default.json';

const text = (value: Ratio): string => `${value.num}/${value.den}`;
const AT = '2026-10-06T14:02:00-04:00';
const EMAIL = 'email.sent' as const;
const VERIFIED_BP = DEFAULT_POLICY.bp.thresholds.verified;
const PARTIAL_BP = DEFAULT_POLICY.bp.thresholds.partial;

const emailClaim = (counterparty: string | undefined, subjectHint = 'Q3 deck'): FeatureClaim => ({
  type: EMAIL,
  claimedAt: AT,
  claimedAtPrecision: 'minute',
  ...(counterparty === undefined ? {} : { counterparty }),
  subjectHint,
});
const seen = (counterparty: string | undefined, subjectHint = 'Q3 deck', occurredAt = AT) => ({
  occurredAt,
  ...(counterparty === undefined ? {} : { counterparty }),
  subjectHint,
});

function withWeights(weights: Partial<Record<keyof typeof defaultPolicyJson.features, number>>): Policy {
  return loadPolicy({ ...defaultPolicyJson, features: { ...defaultPolicyJson.features, ...weights } });
}

describe('exact score under awkward basis-point weights (§5.3)', () => {
  const claim = emailClaim('priya@company.com');
  /** Domain match, subject J = 1/3, and Δ = tolerance + 1 ms, so timeProximity = 2639999/2640000. */
  const observation = seen('raj@company.com', 'Q3 budget', '2026-10-06T14:04:00.001-04:00');

  it('weights 0.0001 / 0.0003 / 0.0007 / 0.9973 give the hand-computed fraction', () => {
    const policy = withWeights({
      timeProximity: 0.0001,
      counterpartyExact: 0.0003,
      counterpartyDomain: 0.0007,
      subjectOverlap: 0.9973,
    });
    // (1·2639999/2640000 + 3·0 + 7·1 + 9973·1/3) / 9984, reduced by hand in BigInt.
    expect(text(features(claim, observation, policy).score)).toBe('2932453333/8785920000');
  });

  it('a score of exactly 1/2 meets thresholds.partial where a float sum gives 0.4999999999999999', () => {
    const policy = withWeights({
      timeProximity: 0.0001,
      counterpartyExact: 0.0003,
      counterpartyDomain: 0.0013,
      subjectOverlap: 0.0033,
    });
    const result = features(claim, seen('raj@company.com', 'Q3 budget'), policy);
    expect(text(result.score)).toBe('1/2');
    expect(ratioGteBasisPoints(result.score, policy.bp.thresholds.partial)).toBe(true);
    const reversed = loadPolicy({
      ...defaultPolicyJson,
      features: policy.features,
      featuresByType: {
        ...defaultPolicyJson.featuresByType,
        [EMAIL]: [...defaultPolicyJson.featuresByType[EMAIL]].reverse(),
      },
    });
    expect(features(claim, seen('raj@company.com', 'Q3 budget'), reversed).score).toEqual(result.score);
  });
});

/** Confusable twins of priya@company.com (or kate@company.com), one per family. */
const CONFUSABLES: readonly (readonly [string, string, string])[] = [
  ['Cyrillic a (U+0430)', 'priya@company.com', 'priy\u0430@company.com'],
  ['dotless i (U+0131)', 'priya@company.com', 'pr\u0131ya@company.com'],
  ['Kelvin sign (U+212A)', 'kate@company.com', '\u212Aate@company.com'],
  ['fullwidth p (U+FF50)', 'priya@company.com', '\uFF50riya@company.com'],
  ['mathematical bold p (U+1D429)', 'priya@company.com', '\u{1D429}riya@company.com'],
  ['Greek omicron in the domain (U+03BF)', 'priya@company.com', 'priya@c\u03BFmpany.com'],
  ['zero-width joiner in the local part', 'priya@company.com', 'pri\u200Dya@company.com'],
  ['NFD e + combining acute vs NFC', 'jos\u00E9@company.com', 'jose\u0301@company.com'],
  ['xn-- look-alike domain', 'priya@company.com', 'priya@xn--cmpany-u2a.com'],
  ['bidi override in the local part', 'priya@company.com', '\u202Eayirp@company.com'],
];

describe('confusables through features(): 0 on both address features unless identical', () => {
  it.each(CONFUSABLES)('%s, observation side', (_label, plain, twin) => {
    const result = features(emailClaim(plain), seen(twin), DEFAULT_POLICY);
    expect(result.signals).toMatchObject({ counterpartyExact: 0, counterpartyDomain: 0 });
    expect(result.reasonCodes).toEqual(['cp.confusable']);
    expect(text(result.score)).toBe('4/9');
    expect(ratioGteBasisPoints(result.score, PARTIAL_BP)).toBe(false);
  });

  it.each(CONFUSABLES)('%s, claim side', (_label, plain, twin) => {
    const result = features(emailClaim(twin), seen(plain), DEFAULT_POLICY);
    expect(result.signals).toMatchObject({ counterpartyExact: 0, counterpartyDomain: 0 });
    expect(result.reasonCodes).toEqual(['cp.confusable']);
  });

  it.each(CONFUSABLES)('%s, identical on both sides: 1 with cp.non_ascii', (_label, _plain, twin) => {
    const result = features(emailClaim(twin), seen(twin), DEFAULT_POLICY);
    expect(result.signals).toMatchObject({ counterpartyExact: 1, counterpartyDomain: 1 });
    expect(result.reasonCodes).toEqual(['cp.non_ascii']);
    expect(text(result.score)).toBe('1/1');
  });

  it('a name claim never matches a confusable local part (Kelvin, fullwidth, dotless i)', () => {
    for (const twin of ['\u212Aate@company.com', '\uFF50riya@company.com', 'pr\u0131ya@company.com']) {
      const claim = emailClaim(twin.startsWith('\u212A') ? 'Kate' : 'Priya');
      expect(features(claim, seen(twin), DEFAULT_POLICY).signals.counterpartyName).toBe(0);
    }
  });
});

/** [label, claim address, observation address, score, reasons]. */
const PLUS_TAGS: readonly (readonly [string, string, string, string, readonly string[]])[] = [
  ['tagged observation', 'priya@gmail.com', 'priya+agent@gmail.com', '11/18', ['cp.plus_tag']],
  ['tagged claim', 'priya+agent@gmail.com', 'priya@gmail.com', '11/18', ['cp.plus_tag']],
  ['two different tags', 'priya+a@gmail.com', 'priya+b@gmail.com', '11/18', ['cp.plus_tag']],
  ['tag and ASCII case', 'Priya+X@Gmail.com', 'priya@gmail.com', '11/18', ['cp.plus_tag']],
  ['another mailbox tagged with the name', 'raj+priya@gmail.com', 'priya@gmail.com', '4/9', []],
  ['same free-mail domain, other mailbox', 'priya@gmail.com', 'priya.k@gmail.com', '4/9', []],
  ['same local part, another free-mail domain', 'priya@gmail.com', 'priya+x@outlook.com', '4/9', []],
];

describe('+tags on free mail: PARTIAL at most, never VERIFIED', () => {
  it.each(PLUS_TAGS)('%s', (_label, claimed, observed, score, reasons) => {
    const result = features(emailClaim(claimed), seen(observed), DEFAULT_POLICY);
    expect(result.signals.counterpartyExact).toBe(0);
    expect(text(result.score)).toBe(score);
    expect(result.reasonCodes).toEqual(reasons);
    expect(ratioGteBasisPoints(result.score, VERIFIED_BP)).toBe(false);
  });
});

/** [label, observation counterparty, score] against a claim to priya@company.com. */
const SPOOFS: readonly (readonly [string, string, string])[] = [
  ['quoted display name holding the address', '"priya@company.com" <attacker@evil.example>', '4/9'],
  ['unquoted display name holding the address', 'priya@company.com <attacker@evil.example>', '4/9'],
  ['display name only, address elsewhere', 'Priya <attacker@evil.example>', '4/9'],
  ['the address in a comment', 'attacker@evil.example (priya@company.com)', '4/9'],
  ['two addresses', 'priya@company.com, attacker@evil.example', '4/9'],
  ['two angle-bracket groups', '<priya@company.com> <attacker@evil.example>', '4/9'],
  ['nested angle brackets', '"P" <attacker@evil.example<priya@company.com>', '4/9'],
  ['real address with any display name', '"Attacker" <priya@company.com>', '1/1'],
];

describe('display-name spoofs: only the address inside the brackets is compared', () => {
  it.each(SPOOFS)('%s', (_label, observed, score) => {
    const result = features(emailClaim('priya@company.com'), seen(observed), DEFAULT_POLICY);
    expect(text(result.score)).toBe(score);
  });
});

describe('claims with no name or subject tokens are never matched on time alone', () => {
  it.each([
    ['punctuation', '---'],
    ['an emoji', '\u{1F600}'],
    ['a zero-width space', '\u200B'],
    ['blank', '   '],
    ['a broken address', 'priya@'],
    ['a bidi-override name', '\u202Eayirp'],
    ['a fullwidth at sign, not an address', 'priya\uFF20company.com'],
  ])('a counterparty that is %s', (_label, counterparty) => {
    const claim = emailClaim(counterparty, 'Re: Fwd: the');
    expect(applicableFeatures(claim, DEFAULT_POLICY)).toEqual(['timeProximity']);
    expect(isUnderspecified(claim, DEFAULT_POLICY)).toBe(true);
    expect(isAssignable(claim, DEFAULT_POLICY)).toBe(false);
  });

  it.each([
    ['only reply prefixes and stop words', 'Re: Fwd: the'],
    ['only punctuation', '!!! ---'],
    ['a bidi override', 'Q3 \u202Edeck'],
    ['empty', ''],
  ])('a calendar subject with %s leaves the claim underspecified', (_label, subjectHint) => {
    const claim: FeatureClaim = {
      type: 'calendar.created',
      claimedAt: AT,
      claimedAtPrecision: 'minute',
      targetAt: '2026-10-08T14:00:00-04:00',
      subjectHint,
    };
    expect(applicableFeatures(claim, DEFAULT_POLICY)).toEqual(['timeProximity']);
    expect(isUnderspecified(claim, DEFAULT_POLICY)).toBe(true);
  });
});

describe('an observation with no tokens scores 0, never "not applicable" (§5.2)', () => {
  const claim = emailClaim('priya@company.com');

  const exactAddress: FeatureObservation = { occurredAt: AT, counterparty: 'priya@company.com' };

  it.each([
    ['no subject', exactAddress],
    ['an empty subject', { ...exactAddress, subjectHint: '' }],
    ['a stop-word subject', { ...exactAddress, subjectHint: 'Re: the' }],
    ['a bidi-override subject', { ...exactAddress, subjectHint: '\u202Ekced 3Q' }],
  ] as const)('%s keeps subjectOverlap in the denominator', (_label, observation) => {
    const result = features(claim, observation, DEFAULT_POLICY);
    expect(result.signals.subjectOverlap).toBe(0);
    expect(text(result.score)).toBe('5/6');
  });

  it('a purchase observation with no merchant tokens scores merchantMatch 0', () => {
    const purchase: FeatureClaim = {
      type: 'purchase.made',
      claimedAt: AT,
      claimedAtPrecision: 'minute',
      counterparty: 'Acme',
      amountCents: 3000,
      currency: 'USD',
    };
    for (const merchant of [undefined, '', '---', 'acme@', '\u202Eemca']) {
      const observation: FeatureObservation = {
        occurredAt: AT,
        amountCents: 3000,
        currency: 'USD',
        ...(merchant === undefined ? {} : { merchant }),
      };
      const result = features(purchase, observation, DEFAULT_POLICY);
      expect(result.signals.merchantMatch).toBe(0);
      expect(text(result.score)).toBe('5/7');
    }
  });
});

describe('a claim no weighted feature can score is never given a score (§5.3, HR5/HR6)', () => {
  /**
   * The loader rejects identity features of weight 0, but not an EMPTY identity list for a type with sources:
   * then a claim with only zero-weight applicable features is not underspecified, yet has nothing to score.
   * Either the loader rejects this policy (contract issue raised) or features() fails loud; never a number.
   */
  it('the loader rejects the policy, or features() throws a typed RatioError', () => {
    const document = {
      ...defaultPolicyJson,
      features: { ...defaultPolicyJson.features, timeProximity: 0 },
      identityFeatures: { ...defaultPolicyJson.identityFeatures, [EMAIL]: [] },
    };
    let policy: Policy;
    try {
      policy = loadPolicy(document);
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyError);
      return;
    }
    const bare: FeatureClaim = { type: EMAIL, claimedAt: AT, claimedAtPrecision: 'minute' };
    expect(applicableFeatures(bare, policy)).toEqual(['timeProximity']);
    expect(isUnderspecified(bare, policy)).toBe(false);
    expect(() => features(bare, { occurredAt: AT }, policy)).toThrow(RatioError);
  });
});
