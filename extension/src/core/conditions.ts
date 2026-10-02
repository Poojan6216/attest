/**
 * Rule conditions and finality (docs/grading.md §6.1, §8; module contract §13 `conditions.ts`).
 *
 * `evaluateConditions(facts)` gives one evaluator per policy condition, each lazy and memoised, each returning
 * `null` when the condition is NOT APPLICABLE. A rule matches iff every condition its `when` names is applicable
 * and has the written value (§6.1: all must hold); first match wins (§6). Claim-less evaluation: with no claim
 * only `unaskedLikely` and `observedScopeExceedsDeclared` are applicable; with a claim those two are not.
 *
 * Split for size: conditions-coverage.ts (eligibility, `coverage`, `graceElapsed`), conditions-scope.ts (grant
 * and permission conditions), conditions-finality.ts (`isFinalizable`, §8). Import from here.
 *
 * Every grade-relevant comparison is exact: scores against thresholds in BigInt basis points (ratio.ts), times in
 * integer milliseconds, amounts in integer cents (§5.3). PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import {
  type CoverageResult,
  coverageFrom,
  type EligibleCoverage,
  eligibleCoverage,
  graceSyncMs,
  type SourceGrace,
  syncedSources,
} from './conditions-coverage';
import {
  type AllowlistCheck,
  amountAboveCeiling,
  type CeilingCheck,
  counterpartyNotAllowed,
  cumulativeAboveCeiling,
  type CumulativeCheck,
  observedScopeExceedsDeclared,
  targetMissing,
  typeNotInGrant,
  unaskedLikely,
} from './conditions-scope';
import { isUnderspecified } from './features';
import type { Policy, PolicyRule, ThresholdName } from './policy';
import { type Ratio, ratioGteBasisPoints } from './ratio';
import type { Claim, Coverage, GradeContext, Grant, Observation } from './schema';
import { claimWindow } from './window';

export {
  type CapReason,
  type CoverageCap,
  coverageLevel,
  type CoveragePolicy,
  type CoverageResult,
  type EligibleCoverage,
  type EligibleEntry,
  eligibleCoverage,
  entryInstants,
  type EntryInstants,
  graceElapsed,
  type SourceCoverage,
  type SourceGrace,
} from './conditions-coverage';
export { type Finality, type FinalityInput, isFinalizable } from './conditions-finality';
export {
  type AllowlistCheck,
  amountAboveCeiling,
  type CeilingCheck,
  counterpartyNotAllowed,
  cumulativeAboveCeiling,
  type CumulativeCheck,
  observedScopeExceedsDeclared,
  type ScopePolicy,
  targetMissing,
  typeNotInGrant,
  unaskedLikely,
} from './conditions-scope';

export type RuleWhen = PolicyRule['when'];

/** The inputs of one grading the conditions read (coverage already filtered to `lastSyncAt ≤ evaluatedAt`). */
export interface ConditionFacts {
  readonly claim: Claim | null;
  readonly grant: Grant;
  readonly policy: Policy;
  readonly coverage: Coverage;
  readonly context: GradeContext;
  /** The best candidate's exact score (§8), or null when no candidate was scored. */
  readonly bestScore: Ratio | null;
  /** The assigned candidate: the best one when its score ≥ `thresholds.partial`, else null (§8). */
  readonly assigned: Observation | null;
}

/** One evaluator per §6.1 condition, lazy and memoised; `null` means NOT APPLICABLE. */
export interface Conditions {
  /** The claim's eligible coverage, shared by `coverage`, `graceElapsed` and finality; null without a claim. */
  readonly eligible: () => EligibleCoverage | null;
  readonly unaskedLikely: () => boolean | null;
  readonly observedScopeExceedsDeclared: () => boolean | null;
  readonly typeNotInGrant: () => boolean | null;
  readonly counterpartyNotAllowed: () => AllowlistCheck | null;
  readonly amountAboveCeiling: () => CeilingCheck | null;
  readonly cumulativeAboveCeiling: () => CumulativeCheck | null;
  readonly targetMissing: () => boolean | null;
  readonly underspecified: () => boolean | null;
  readonly coverage: () => CoverageResult | null;
  /** Per relevant source, whether its grace has elapsed; `graceElapsed` is true iff every one has. */
  readonly graceElapsed: () => readonly SourceGrace[] | null;
  readonly bestScoreGte: (threshold: ThresholdName) => boolean | null;
  readonly bestScoreLt: (threshold: ThresholdName) => boolean | null;
}

/** The §6.1 conditions this module evaluates, by name: a test pins it to the policy's ConditionName list. */
export const EVALUATED_CONDITIONS = [
  'unaskedLikely',
  'observedScopeExceedsDeclared',
  'typeNotInGrant',
  'counterpartyNotAllowed',
  'amountAboveCeiling',
  'cumulativeAboveCeiling',
  'targetMissing',
  'underspecified',
  'coverage',
  'bestScoreGte',
  'bestScoreLt',
  'graceElapsed',
] as const satisfies readonly (keyof RuleWhen)[];

/** `compute` runs at most once; later calls return its first result (the argument never changes per grading). */
function once<A extends unknown[], T>(compute: (...args: A) => T): (...args: A) => T {
  let cache: { readonly value: T } | undefined;
  return (...args) => (cache ??= { value: compute(...args) }).value;
}

/** A condition that does not apply to this grading (§6.1): shared, so a grading allocates nothing for it. */
const NOT_APPLICABLE = (): null => null;

/** The score conditions of a claim grading (claim-less, they do not apply). */
function scoreConditions(facts: ConditionFacts): Pick<Conditions, 'bestScoreGte' | 'bestScoreLt'> {
  const { bestScore, policy } = facts;
  const gte = (threshold: ThresholdName): boolean =>
    bestScore !== null && ratioGteBasisPoints(bestScore, policy.bp.thresholds[threshold]);
  return { bestScoreGte: (threshold) => gte(threshold), bestScoreLt: (threshold) => !gte(threshold) };
}

/** Claim-less (§6.1): only `unaskedLikely` and `observedScopeExceedsDeclared` apply. */
function claimlessConditions(facts: ConditionFacts): Conditions {
  const { grant, policy, context } = facts;
  return {
    eligible: NOT_APPLICABLE,
    unaskedLikely: once(() => unaskedLikely(context, policy)),
    observedScopeExceedsDeclared: once(() => observedScopeExceedsDeclared(grant, context)),
    typeNotInGrant: NOT_APPLICABLE,
    counterpartyNotAllowed: NOT_APPLICABLE,
    amountAboveCeiling: NOT_APPLICABLE,
    cumulativeAboveCeiling: NOT_APPLICABLE,
    targetMissing: NOT_APPLICABLE,
    underspecified: NOT_APPLICABLE,
    coverage: NOT_APPLICABLE,
    graceElapsed: NOT_APPLICABLE,
    bestScoreGte: NOT_APPLICABLE,
    bestScoreLt: NOT_APPLICABLE,
  };
}

/** With a claim (§6.1): every condition but the two claim-less ones applies. */
function claimConditions(claim: Claim, facts: ConditionFacts): Conditions {
  const { grant, policy, coverage, context, assigned } = facts;
  const eligible = once(() => eligibleCoverage(claim, grant, coverage, policy));
  return {
    eligible,
    unaskedLikely: NOT_APPLICABLE,
    observedScopeExceedsDeclared: NOT_APPLICABLE,
    typeNotInGrant: once(() => typeNotInGrant(claim, grant)),
    counterpartyNotAllowed: once(() => counterpartyNotAllowed(claim, assigned, grant, policy)),
    amountAboveCeiling: once(() => amountAboveCeiling(claim, assigned, grant, policy)),
    cumulativeAboveCeiling: once(() => cumulativeAboveCeiling(claim, grant, context, policy)),
    targetMissing: once(() => targetMissing(claim)),
    underspecified: once(() => isUnderspecified(claim, policy)),
    coverage: once(() => coverageFrom(eligible(), claimWindow(claim, policy))),
    graceElapsed: once(() => syncedSources(eligible(), graceSyncMs(claim, policy))),
    ...scoreConditions(facts),
  };
}

/** The §6.1 evaluators for one grading. */
export function evaluateConditions(facts: ConditionFacts): Conditions {
  return facts.claim === null ? claimlessConditions(facts) : claimConditions(facts.claim, facts);
}

/** A flag condition holds iff it is applicable and has the written value. */
function flagHolds(expected: boolean | undefined, actual: () => boolean | null): boolean {
  return expected === undefined || actual() === expected;
}

function valueOf(check: { readonly value: boolean } | null): boolean | null {
  return check === null ? null : check.value;
}

function graceValue(sources: readonly SourceGrace[] | null): boolean | null {
  return sources === null ? null : sources.every((source) => source.elapsed);
}

/** §6.1: a rule matches iff every condition its `when` names is applicable and holds. */
export function ruleMatches(when: RuleWhen, c: Conditions): boolean {
  return (
    flagHolds(when.unaskedLikely, c.unaskedLikely) &&
    flagHolds(when.observedScopeExceedsDeclared, c.observedScopeExceedsDeclared) &&
    flagHolds(when.typeNotInGrant, c.typeNotInGrant) &&
    flagHolds(when.counterpartyNotAllowed, () => valueOf(c.counterpartyNotAllowed())) &&
    flagHolds(when.amountAboveCeiling, () => valueOf(c.amountAboveCeiling())) &&
    flagHolds(when.cumulativeAboveCeiling, () => valueOf(c.cumulativeAboveCeiling())) &&
    flagHolds(when.targetMissing, c.targetMissing) &&
    flagHolds(when.underspecified, c.underspecified) &&
    (when.coverage === undefined || c.coverage()?.level === when.coverage) &&
    (when.bestScoreGte === undefined || c.bestScoreGte(when.bestScoreGte) === true) &&
    (when.bestScoreLt === undefined || c.bestScoreLt(when.bestScoreLt) === true) &&
    flagHolds(when.graceElapsed, () => graceValue(c.graceElapsed()))
  );
}

/** §6: the first rule in policy order whose conditions all hold, or null (terminal `default_unverifiable`). */
export function firstMatch(rules: readonly PolicyRule[], c: Conditions): PolicyRule | null {
  return rules.find((rule) => ruleMatches(rule.when, c)) ?? null;
}

/**
 * §8: whether the matched rule's truth rested on the assigned candidate (its address or its amount, or the
 * score itself), so an OVER_SCOPE from it waits for grace like PARTIAL instead of finalising at once.
 */
export function candidateDependent(when: RuleWhen, c: Conditions): boolean {
  if (when.bestScoreGte !== undefined || when.bestScoreLt !== undefined) return true;
  if (when.counterpartyNotAllowed === true && c.counterpartyNotAllowed()?.candidateOnly === true) return true;
  return when.amountAboveCeiling === true && c.amountAboveCeiling()?.claimOnly === false;
}
