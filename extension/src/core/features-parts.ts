/**
 * Valuing one (claim, candidate) pair (docs/grading.md §5.1, §5.3): each applicable feature's exact value as two
 * integers, written to parallel arrays. Internal to features.ts, which reads every value from here: `features` and
 * `pairScorer` turn the integers into `NumberRatio`s, and a batch sums them where they lie (the task 1.5 grading perf
 * gate scores ~300,000 pairs, and a value object per feature per pair was most of the work).
 *
 * The values are exactly features.ts's §5.1 definitions: `timeProximity` (features-time.ts), the address features
 * from one `addressVerdict`, `counterpartyName` (`nameMatches`), `subjectOverlap` and `merchantMatch` as Jaccard
 * |A∩B| / |A∪B| (0/1 when both sets are empty), `amountExact` (`sameMoney`), and 0 for `modelScore`.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { type Money, type PreparedMerchant, sameMoney } from './features-content';
import {
  type AddressVerdict,
  addressVerdict,
  nameMatches,
  type PreparedAddress,
} from './features-counterparty';
import type { ObservedFacts } from './features-observed';
import { timeProximityInto } from './features-time';
import type { FeatureName, Policy } from './policy';
import type { ClaimWindow } from './window';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const timeProximityIntoLocal = timeProximityInto;
const addressVerdictLocal = addressVerdict;
const nameMatchesLocal = nameMatches;
const sameMoneyLocal = sameMoney;

/** What the claim alone says (§5.2: applicability reads only these). */
export interface ClaimFacts {
  readonly window: ClaimWindow | null;
  readonly address: PreparedAddress | null;
  readonly nameTokens: readonly string[];
  readonly subject: ReadonlySet<string>;
  readonly merchant: PreparedMerchant | null;
  readonly money: Money;
}

/** A claim's facts under one policy, with its applicable features (policy order) and their weights. */
export interface ClaimPlan {
  readonly facts: ClaimFacts;
  readonly applicable: readonly FeatureName[];
  readonly weights: readonly number[];
  /** `counterpartyExact` or `counterpartyDomain` applies: each pair compares addresses once. */
  readonly usesAddress: boolean;
  /** `facts.subject` and the merchant's name tokens, as arrays (each set's members once). */
  readonly subjectTokens: readonly string[];
  readonly merchantTokens: readonly string[];
}

/** The policy fields valuing reads. A loaded `Policy` satisfies it. */
export type PartsPolicy = Pick<Policy, 'windows' | 'commonDomains'>;

/**
 * Jaccard |A∩B| / |A∪B| of the set whose members are `tokens` and `other`, written to `nums[i]` / `dens[i]` (not
 * reduced; 0/1 when both are empty): features-content.ts `jaccardOf`, counted from A's side (|A∩B| is the same
 * from either side) without iterating a set.
 */
function jaccardInto(
  tokens: readonly string[],
  other: ReadonlySet<string>,
  nums: Float64Array,
  dens: Float64Array,
  i: number,
): void {
  let shared = 0;
  for (const token of tokens) if (other.has(token)) shared += 1;
  const union = tokens.length + other.size - shared;
  nums[i] = union === 0 ? 0 : shared;
  dens[i] = union === 0 ? 1 : union;
}

/** One applicable feature's value for the pair (see the file comment), written to `nums[i]` / `dens[i]`. */
function valueInto(
  feature: FeatureName | undefined,
  plan: ClaimPlan,
  observed: ObservedFacts,
  verdict: AddressVerdict | null,
  policy: PartsPolicy,
  nums: Float64Array,
  dens: Float64Array,
  i: number,
): void {
  const { facts } = plan;
  dens[i] = 1;
  nums[i] = 0;
  if (feature === 'timeProximity') {
    if (facts.window !== null) {
      timeProximityIntoLocal(facts.window, observed.occurredMs, policy.windows.toleranceMin, nums, dens, i);
    }
  } else if (feature === 'counterpartyExact') {
    nums[i] = verdict?.exact === true ? 1 : 0;
  } else if (feature === 'counterpartyDomain') {
    nums[i] = verdict?.domain === true ? 1 : 0;
  } else if (feature === 'counterpartyName') {
    nums[i] = nameMatchesLocal(facts.nameTokens, observed.address) ? 1 : 0;
  } else if (feature === 'subjectOverlap') {
    if (facts.subject.size > 0) jaccardInto(plan.subjectTokens, observed.subject, nums, dens, i);
  } else if (feature === 'amountExact') {
    nums[i] = sameMoneyLocal(facts.money, observed) ? 1 : 0;
  } else if (feature === 'merchantMatch') {
    const merchant = observed.merchantName;
    if (facts.merchant !== null && merchant !== null) {
      jaccardInto(plan.merchantTokens, merchant.tokens, nums, dens, i);
    }
  }
}

/**
 * Values one pair into `nums` / `dens` (in `plan.applicable` order, not reduced): the address comparison once for
 * both address features, then each applicable feature. Returns the address verdict (its `cp.*` reason), if any.
 */
export function fillParts(
  plan: ClaimPlan,
  observed: ObservedFacts,
  policy: PartsPolicy,
  nums: Float64Array,
  dens: Float64Array,
): AddressVerdict | null {
  const { facts, applicable } = plan;
  const verdict =
    plan.usesAddress && facts.address !== null
      ? addressVerdictLocal(facts.address, observed.address, policy.commonDomains)
      : null;
  for (let i = 0; i < applicable.length; i += 1) {
    valueInto(applicable[i], plan, observed, verdict, policy, nums, dens, i);
  }
  return verdict;
}
