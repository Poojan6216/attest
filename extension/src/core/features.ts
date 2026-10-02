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
 * Speed (the task 1.5 grading perf gate scores every (claim, candidate) pair of a batch): what a claim says is
 * read once into a plan (its window, prepared address, token sets, the applicable features and their weights;
 * features-memo.ts), what an observation says once per object (features-observed.ts), and each pair's values and
 * exact score once (`pairScorer`, shared with `features`): a batch asks for every pair's score in assignment and
 * again in `grade`'s best candidate, and for the best one's display signals. Feature values are held as integer
 * pairs and summed in Number only while provably exact (ratio.ts `weightedScoreOf`). Every memo is used only
 * while every input it was computed from is unchanged, so a memo saves work and never changes a result.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { type Money, prepareMerchant, stopWordSet, subjectTokensWithout } from './features-content';
import { prepareAddress } from './features-counterparty';
import { type Memo, memoised } from './features-memo';
import {
  type FeatureObservation,
  type ObservedFacts,
  observedFacts,
  type TextFacts,
} from './features-observed';
import { type ClaimFacts, type ClaimPlan, fillParts } from './features-parts';
import { counterparty } from './normalize';
import type { FeatureName, Policy } from './policy';
import {
  NUMBER_RATIO_ONE,
  NUMBER_RATIO_ZERO,
  type NumberRatio,
  type Ratio,
  type Score,
  toDisplay,
  toDisplayOf,
  weightedFractionOf,
  weightedScoreExact,
} from './ratio';
import type { ActionType, ReasonCode } from './schema';
import { claimWindow, type WindowClaim } from './window';

export type { CounterpartyReason } from './features-counterparty';
export { type FeatureObservation, freshFacts, type ObservedFacts, TextFacts } from './features-observed';

/**
 * The claim fields features read: its timing as window.ts reads it, its money, its counterparty and its
 * subject. A parsed `Claim` satisfies it: optional fields also accept an explicit `undefined`, which is how
 * Zod types an optional output field.
 */
export interface FeatureClaim extends Money, WindowClaim {
  readonly counterparty?: string | undefined;
  readonly subjectHint?: string | undefined;
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

/** §5.2: whether the claim has the field a feature reads (with at least one token where it has tokens). */
function applies(feature: FeatureName, facts: ClaimFacts): boolean {
  switch (feature) {
    case 'timeProximity':
      return facts.window !== null;
    case 'counterpartyExact':
    case 'counterpartyDomain':
      return facts.address !== null;
    case 'counterpartyName':
      return facts.nameTokens.length > 0;
    case 'subjectOverlap':
      return facts.subject.size > 0;
    case 'amountExact':
      return facts.money.amountCents !== undefined;
    case 'merchantMatch':
      return facts.merchant !== null;
    case 'modelScore':
      /** Reserved for Sprint 5 (§5.1): never applicable in Sprint 1. */
      return false;
  }
}

const COUNTERPARTY_FEATURES: readonly FeatureName[] = [
  'counterpartyExact',
  'counterpartyDomain',
  'counterpartyName',
];
const NO_TOKENS: ReadonlySet<string> = new Set();

/** Whether a listed feature reads the counterparty as an address or a name. */
function readsCounterparty(listed: readonly FeatureName[]): boolean {
  for (const feature of COUNTERPARTY_FEATURES) if (listed.includes(feature)) return true;
  return false;
}

/**
 * The facts the features listed for the claim's type read (§5.2 decides applicability from these alone): a fact
 * no listed feature reads is left empty, since only listed features are ever checked or valued.
 */
function computeFacts(claim: FeatureClaim, policy: FeaturePolicy, texts: TextFacts | null): ClaimFacts {
  const listed = policy.featuresByType[claim.type];
  const read = texts?.stopWords === policy.normalize.stopWords ? texts : null;
  const raw = claim.counterparty;
  const party = readsCounterparty(listed) ? (read === null ? counterparty(raw) : read.party(raw)) : null;
  return {
    window: claimWindow(claim, policy),
    address: party?.kind === 'address' ? prepareAddress(party) : null,
    nameTokens: party?.kind === 'name' ? party.tokens : [],
    subject: listed.includes('subjectOverlap')
      ? read === null
        ? subjectTokensWithout(claim.subjectHint, stopWordSet(policy.normalize.stopWords))
        : read.subject(claim.subjectHint)
      : NO_TOKENS,
    merchant: listed.includes('merchantMatch')
      ? read === null
        ? prepareMerchant(raw)
        : read.merchant(raw)
      : null,
    money: { amountCents: claim.amountCents, currency: claim.currency },
  };
}

function computePlan(claim: FeatureClaim, policy: FeaturePolicy, texts: TextFacts | null): ClaimPlan {
  const facts = computeFacts(claim, policy, texts);
  const applicable: FeatureName[] = [];
  const weights: number[] = [];
  for (const feature of policy.featuresByType[claim.type]) {
    if (!applies(feature, facts)) continue;
    applicable.push(feature);
    weights.push(policy.bp.features[feature]);
  }
  return {
    facts,
    applicable,
    weights,
    usesAddress: applicable.includes('counterpartyExact') || applicable.includes('counterpartyDomain'),
    subjectTokens: [...facts.subject],
    merchantTokens: facts.merchant === null ? [] : [...facts.merchant.tokens],
  };
}

const CLAIM_PLANS: Memo<FeatureClaim, ClaimPlan> = new WeakMap();

/**
 * The claim's plan, computed once per claim object while every claim field and policy part it reads is unchanged
 * (features-memo.ts): `gradeBatch` scores each claim against every candidate.
 */
function claimPlan(claim: FeatureClaim, policy: FeaturePolicy, texts: TextFacts | null = null): ClaimPlan {
  const inputs = [
    policy.windows,
    policy.normalize.stopWords,
    policy.featuresByType[claim.type],
    policy.bp.features,
    claim.type,
    claim.claimedAt,
    claim.claimedAtPrecision,
    claim.claimedAtEnd,
    claim.targetAt,
    claim.counterparty,
    claim.subjectHint,
    claim.amountCents,
    claim.currency,
  ];
  return memoised(CLAIM_PLANS, claim, inputs, () => computePlan(claim, policy, texts));
}

/**
 * Plans every claim of a batch whose type has sources (the ones `isAssignable` plans), reading each counterparty,
 * subject and merchant text once per batch (`texts`): the plans `claimPlan` keeps, as it would compute them.
 */
export function planClaims(claims: readonly FeatureClaim[], policy: FeaturePolicy, texts: TextFacts): void {
  for (const claim of claims)
    if (policy.sourcesByType[claim.type].length > 0) claimPlan(claim, policy, texts);
}

/** §5.2: the features of `policy.featuresByType[claim.type]` that apply to this claim, in policy order. */
export function applicableFeatures(claim: FeatureClaim, policy: FeaturePolicy): FeatureName[] {
  return [...claimPlan(claim, policy).applicable];
}

function underspecifiedFrom(plan: ClaimPlan, type: ActionType, policy: FeaturePolicy): boolean {
  const identity = policy.identityFeatures[type];
  return identity.length > 0 && !identity.some((feature) => plan.applicable.includes(feature));
}

/**
 * §5.2: the type's identity list is non-empty and none of its features applies ("Done! I've sent the
 * email."). Graded by rule `underspecified`, never matched on time alone.
 */
export function isUnderspecified(claim: FeatureClaim, policy: FeaturePolicy): boolean {
  return underspecifiedFrom(claimPlan(claim, policy), claim.type, policy);
}

/**
 * §4.3: whether the claim takes part in assignment: its type has sources, it has a window (a calendar claim
 * needs `targetAt`; window.ts returns null without it), and it is not underspecified.
 */
export function isAssignable(claim: FeatureClaim, policy: FeaturePolicy): boolean {
  if (policy.sourcesByType[claim.type].length === 0) return false;
  const plan = claimPlan(claim, policy);
  return plan.facts.window !== null && !underspecifiedFrom(plan, claim.type, policy);
}

/** One pair's feature values (in `plan.applicable` order), exact score and `cp.*` reason. */
interface PairValues {
  readonly observed: ObservedFacts;
  readonly values: readonly NumberRatio[];
  readonly score: Score;
  readonly reason: ReasonCode | undefined;
}

/** A value's integer parts as a NumberRatio: the shared constants for 0 and 1. */
function asNumberRatio(num: number, den: number): NumberRatio {
  if (den === 1 && num === 0) return NUMBER_RATIO_ZERO;
  if (den === 1 && num === 1) return NUMBER_RATIO_ONE;
  return { num, den };
}

function pairValues(plan: ClaimPlan, observed: ObservedFacts, policy: FeaturePolicy): PairValues {
  const nums = new Float64Array(plan.applicable.length);
  const dens = new Float64Array(plan.applicable.length);
  const verdict = fillParts(plan, observed, policy, nums, dens);
  const values = plan.applicable.map((_, i) => asNumberRatio(nums[i] ?? 0, dens[i] ?? 1));
  return { observed, values, score: weightedScoreExact(plan.weights, values), reason: verdict?.reason };
}

/** The `FeatureResult` of a valued pair: display signals per applicable feature and the score, exact score, reason. */
function resultOf(plan: ClaimPlan, pair: PairValues): FeatureResult {
  const signals: Record<string, number> = {};
  plan.applicable.forEach((feature, i) => {
    const value = pair.values[i] ?? NUMBER_RATIO_ZERO;
    signals[feature] = toDisplayOf(value.num, value.den);
  });
  const { score } = pair;
  const exact = score.ratio;
  signals.score = Number.isNaN(score.num) ? toDisplay(exact) : toDisplayOf(score.num, score.den);
  return { score: exact, signals, reasonCodes: pair.reason === undefined ? [] : [pair.reason] };
}

/**
 * One claim's scorer over a batch's rows (§5): the claim's plan read once, each pair valued with no memo (a batch
 * reads every row's facts once and scores each pair once, keeping the scores itself), with the same valuing
 * (features-parts.ts) and the same exact sum as `features` and `pairScorer`, so it gives their results. Make it for
 * assignable claims (`isAssignable`): with no weighted applicable feature, `RatioError('zero_weight_sum')` is thrown.
 */
export class RowScorer {
  readonly #plan: ClaimPlan;
  readonly #nums: Float64Array;
  readonly #dens: Float64Array;

  constructor(
    claim: FeatureClaim,
    readonly policy: FeaturePolicy,
  ) {
    this.#plan = claimPlan(claim, policy);
    this.#nums = new Float64Array(this.#plan.applicable.length);
    this.#dens = new Float64Array(this.#plan.applicable.length);
  }

  /**
   * The pair's exact score as an unreduced fraction of two safe integers in `out` (ratio.ts `weightedFractionOf`),
   * for exact comparisons; false when the score needs BigInt (then `score` gives it).
   */
  fraction(observed: ObservedFacts, out: Float64Array): boolean {
    fillParts(this.#plan, observed, this.policy, this.#nums, this.#dens);
    return weightedFractionOf(this.#plan.weights, this.#nums, this.#dens, out);
  }

  /** The pair's exact score: the `Score` `pairScorer` gives for the observation the facts were read from. */
  score(observed: ObservedFacts): Score {
    return pairValues(this.#plan, observed, this.policy).score;
  }

  /** `features(claim, observation, policy)` for the observation the facts were read from. */
  result(observed: ObservedFacts): FeatureResult {
    return resultOf(this.#plan, pairValues(this.#plan, observed, this.policy));
  }
}

/** One claim's valued pairs, kept while the plan and the policy parts beside it are unchanged. */
interface ClaimPairs {
  readonly plan: ClaimPlan;
  readonly policy: Pick<FeaturePolicy, 'windows' | 'commonDomains'>;
  readonly pairs: WeakMap<FeatureObservation, PairValues>;
}

const CLAIM_PAIRS = new WeakMap<FeatureClaim, ClaimPairs>();

function claimPairs(claim: FeatureClaim, plan: ClaimPlan, policy: FeaturePolicy): ClaimPairs {
  const held = CLAIM_PAIRS.get(claim);
  const { windows, commonDomains } = policy;
  if (held?.plan === plan && held.policy.windows === windows && held.policy.commonDomains === commonDomains) {
    return held;
  }
  const fresh: ClaimPairs = { plan, policy: { windows, commonDomains }, pairs: new WeakMap() };
  CLAIM_PAIRS.set(claim, fresh);
  return fresh;
}

/**
 * The pair's values, computed at most once while the claim plan and the observation's fields are unchanged (a
 * remembered pair is checked against the observation itself, `ObservedFacts.matches`).
 */
function valuedPair(held: ClaimPairs, observation: FeatureObservation, policy: FeaturePolicy): PairValues {
  const { stopWords } = policy.normalize;
  const cached = held.pairs.get(observation);
  if (cached?.observed.matches(observation, stopWords) === true) return cached;
  const valued = pairValues(held.plan, observedFacts(observation, stopWords), policy);
  held.pairs.set(observation, valued);
  return valued;
}

/**
 * `(observation) => features(claim, observation, policy).score` for one claim, as an exact `Score` (ratio.ts: Number
 * fast paths, the Ratio on demand), its plan read once: each pair is valued at most once (the values are
 * remembered per claim and observation object, and reused by `features`). The claim is read when the scorer is
 * made; make another after editing it. Call it for assignable claims (`isAssignable`): with no weighted
 * applicable feature, `RatioError('zero_weight_sum')` is thrown.
 */
export function pairScorer(
  claim: FeatureClaim,
  policy: FeaturePolicy,
): (observation: FeatureObservation) => Score {
  const held = claimPairs(claim, claimPlan(claim, policy), policy);
  return (observation) => valuedPair(held, observation, policy).score;
}

/**
 * Scores one (claim, observation) pair (§5). Call it for assignable claims (`isAssignable`): when no
 * applicable feature has weight, the score is undefined and the weighted mean throws
 * `RatioError('zero_weight_sum')` rather than inventing one.
 */
export function features(
  claim: FeatureClaim,
  observation: FeatureObservation,
  policy: FeaturePolicy,
): FeatureResult {
  const plan = claimPlan(claim, policy);
  return resultOf(plan, valuedPair(claimPairs(claim, plan, policy), observation, policy));
}
