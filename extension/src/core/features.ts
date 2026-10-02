/**
 * Match features and the exact score (docs/grading.md §5; module contract §13).
 *
 * `features(claim, observation, policy)` scores one (claim, candidate) pair: every applicable feature is an
 * exact rational in [0, 1] (§5.1: features-time.ts, features-counterparty.ts, features-content.ts), and the
 * score is their exact weighted mean over the policy's basis-point weights (§5.3, ratio.ts). No grade is
 * decided in floating point; `signals` are display numbers only.
 *
 * Applicability is decided by the CLAIM alone (§5.2): a feature listed in `policy.featuresByType[type]` is
 * dropped when the claim lacks its field or the field has no tokens, and the address/name split
 * (`normalize.counterparty`) picks exactly one of `counterpartyExact` + `counterpartyDomain` or
 * `counterpartyName`. A missing or empty field on the OBSERVATION scores 0 and is never "not applicable", so
 * no observation can make a claim easier to match by omitting data.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { addressFeatures, type AddressFeatures, nameFeature, observedAddress } from './features-counterparty';
import {
  amountExact,
  type MerchantName,
  merchantMatch,
  merchantName,
  type Money,
  subjectOverlap,
  subjectTokenSet,
} from './features-content';
import { timeProximity } from './features-time';
import { counterparty, type EmailAddress } from './normalize';
import type { FeatureName, Policy } from './policy';
import { RATIO_ZERO, type Ratio, toDisplay, weightedScore } from './ratio';
import type { ActionType, ReasonCode } from './schema';
import { claimWindow, type ClaimWindow, type WindowClaim } from './window';

export type { CounterpartyReason } from './features-counterparty';

/**
 * The claim fields features read: its timing as window.ts reads it, its money, its counterparty and its
 * subject. A parsed `Claim` satisfies it: optional fields also accept an explicit `undefined`, which is how
 * Zod types an optional output field.
 */
export interface FeatureClaim extends Money, WindowClaim {
  readonly counterparty?: string | undefined;
  readonly subjectHint?: string | undefined;
}

/** The observation fields features read. A parsed `Observation` satisfies it. */
export interface FeatureObservation extends Money {
  readonly counterparty?: string | undefined;
  readonly merchant?: string | undefined;
  readonly subjectHint?: string | undefined;
  readonly occurredAt: string;
}

/** The policy fields features read. A loaded `Policy` satisfies it. */
export type FeaturePolicy = Pick<
  Policy,
  'windows' | 'bp' | 'featuresByType' | 'identityFeatures' | 'sourcesByType' | 'commonDomains' | 'normalize'
>;

export interface FeatureResult {
  /** The exact weighted score over the applicable features (§5.3). Compare only this. */
  readonly score: Ratio;
  /** Display numbers rounded to 4 decimals: each applicable feature, plus `score`. Never compared (§5.3). */
  readonly signals: Readonly<Record<string, number>>;
  /** The pair's `cp.*` reasons (§5.1), in §15 table order. */
  readonly reasonCodes: readonly ReasonCode[];
}

/** What the claim alone says, computed once per call (§5.2: applicability reads only these). */
interface ClaimFacts {
  readonly window: ClaimWindow | null;
  readonly address: EmailAddress | null;
  readonly nameTokens: readonly string[];
  readonly subject: readonly string[];
  readonly merchant: MerchantName | null;
  readonly hasAmount: boolean;
}

function claimFacts(claim: FeatureClaim, policy: FeaturePolicy): ClaimFacts {
  const party = counterparty(claim.counterparty);
  return {
    window: claimWindow(claim, policy),
    address: party?.kind === 'address' ? party : null,
    nameTokens: party?.kind === 'name' ? party.tokens : [],
    subject: subjectTokenSet(claim.subjectHint, policy.normalize.stopWords),
    merchant: merchantName(claim.counterparty),
    hasAmount: claim.amountCents !== undefined,
  };
}

/** §5.2: whether the claim has the field a feature reads (with at least one token where it has tokens). */
const APPLICABLE: Readonly<Record<FeatureName, (facts: ClaimFacts) => boolean>> = Object.freeze({
  timeProximity: (facts) => facts.window !== null,
  counterpartyExact: (facts) => facts.address !== null,
  counterpartyDomain: (facts) => facts.address !== null,
  counterpartyName: (facts) => facts.nameTokens.length > 0,
  subjectOverlap: (facts) => facts.subject.length > 0,
  amountExact: (facts) => facts.hasAmount,
  merchantMatch: (facts) => facts.merchant !== null,
  /** Reserved for Sprint 5 (§5.1): never applicable in Sprint 1. */
  modelScore: () => false,
});

function applicableFrom(facts: ClaimFacts, listed: readonly FeatureName[]): FeatureName[] {
  return listed.filter((feature) => APPLICABLE[feature](facts));
}

/** §5.2: the features of `policy.featuresByType[claim.type]` that apply to this claim, in policy order. */
export function applicableFeatures(claim: FeatureClaim, policy: FeaturePolicy): FeatureName[] {
  return applicableFrom(claimFacts(claim, policy), policy.featuresByType[claim.type]);
}

/**
 * §5.2: the type's identity list is non-empty and none of its features applies ("Done! I've sent the
 * email."). Graded by rule `underspecified`, never matched on time alone.
 */
export function isUnderspecified(claim: FeatureClaim, policy: FeaturePolicy): boolean {
  return underspecifiedFrom(claimFacts(claim, policy), claim.type, policy);
}

function underspecifiedFrom(facts: ClaimFacts, type: ActionType, policy: FeaturePolicy): boolean {
  const identity = policy.identityFeatures[type];
  if (identity.length === 0) return false;
  const applicable = new Set(applicableFrom(facts, policy.featuresByType[type]));
  return !identity.some((feature) => applicable.has(feature));
}

/**
 * §4.3: whether the claim takes part in assignment: its type has sources, it has a window (a calendar claim
 * needs `targetAt`; window.ts returns null without it), and it is not underspecified.
 */
export function isAssignable(claim: FeatureClaim, policy: FeaturePolicy): boolean {
  if (policy.sourcesByType[claim.type].length === 0) return false;
  const facts = claimFacts(claim, policy);
  return facts.window !== null && !underspecifiedFrom(facts, claim.type, policy);
}

/** The values one pair needs, with the address comparison done once for both address features. */
interface Pair {
  readonly facts: ClaimFacts;
  readonly claim: FeatureClaim;
  readonly observation: FeatureObservation;
  readonly policy: FeaturePolicy;
  readonly address: AddressFeatures | null;
}

function valueOf(feature: FeatureName, pair: Pair): Ratio {
  const { facts, observation, policy } = pair;
  switch (feature) {
    case 'timeProximity':
      return facts.window === null
        ? RATIO_ZERO
        : timeProximity(facts.window, observation.occurredAt, policy.windows.toleranceMin);
    case 'counterpartyExact':
      return pair.address?.counterpartyExact ?? RATIO_ZERO;
    case 'counterpartyDomain':
      return pair.address?.counterpartyDomain ?? RATIO_ZERO;
    case 'counterpartyName':
      return nameFeature(facts.nameTokens, observedAddress(observation.counterparty));
    case 'subjectOverlap':
      return subjectOverlap(facts.subject, observation.subjectHint, policy.normalize.stopWords);
    case 'amountExact':
      return amountExact(pair.claim, observation);
    case 'merchantMatch':
      return facts.merchant === null ? RATIO_ZERO : merchantMatch(facts.merchant, observation.merchant);
    case 'modelScore':
      return RATIO_ZERO;
  }
}

function addressPair(
  facts: ClaimFacts,
  applicable: readonly FeatureName[],
  observation: FeatureObservation,
  policy: FeaturePolicy,
): AddressFeatures | null {
  const used = applicable.includes('counterpartyExact') || applicable.includes('counterpartyDomain');
  if (!used || facts.address === null) return null;
  return addressFeatures(facts.address, observedAddress(observation.counterparty), policy.commonDomains);
}

/**
 * Scores one (claim, observation) pair (§5). Call it for assignable claims (`isAssignable`): when no
 * applicable feature has weight, the score is undefined and `weightedScore` throws
 * `RatioError('zero_weight_sum')` rather than inventing one.
 */
export function features(
  claim: FeatureClaim,
  observation: FeatureObservation,
  policy: FeaturePolicy,
): FeatureResult {
  const facts = claimFacts(claim, policy);
  const applicable = applicableFrom(facts, policy.featuresByType[claim.type]);
  const pair: Pair = {
    facts,
    claim,
    observation,
    policy,
    address: addressPair(facts, applicable, observation, policy),
  };
  const values = applicable.map((feature) => [feature, valueOf(feature, pair)] as const);
  const score = weightedScore(
    values.map(([feature, value]) => ({ weightBp: policy.bp.features[feature], value })),
  );
  const signals: Record<string, number> = {};
  for (const [feature, value] of values) signals[feature] = toDisplay(value);
  signals.score = toDisplay(score);
  const reason = pair.address?.reason;
  return { score, signals, reasonCodes: reason === undefined ? [] : [reason] };
}
