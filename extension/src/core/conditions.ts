/**
 * Rule conditions and finality (docs/grading.md §6.1, §8; module contract §13 `conditions.ts`).
 *
 * `evaluateConditions(facts)` gives one evaluator per policy condition, each lazy and memoised, each returning
 * `null` when the condition is NOT APPLICABLE. A rule matches iff every condition its `when` names is applicable
 * and has the written value (§6.1: all must hold); first match wins (§6). Claim-less evaluation: with no claim
 * only `unaskedLikely` and `observedScopeExceedsDeclared` are applicable; with a claim those two are not.
 *
 * Split for size: conditions-coverage.ts (eligibility, `graceElapsed`), conditions-level.ts (`coverage`),
 * conditions-scope.ts (grant and permission conditions), conditions-finality.ts (`isFinalizable`, §8). Import from
 * here.
 *
 * Every grade-relevant comparison is exact: scores against thresholds in BigInt basis points (ratio.ts), times in
 * integer milliseconds, amounts in integer cents (§5.3). PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import {
  type CoverageResult,
  type EligibleCoverage,
  eligibleCoverage,
  graceSyncMs,
  type SourceGrace,
  syncedSources,
} from './conditions-coverage';
import { calendarBound, coverageFrom } from './conditions-level';
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
import { isAssignable, isUnderspecified } from './features';
import { isLoadedRules, type Policy, type PolicyRule, type ThresholdName } from './policy';
import { type Ratio, ratioGteBasisPoints } from './ratio';
import type { Claim, Coverage, GradeContext, Grant, Observation } from './schema';
import { claimWindow } from './window';

export {
  type CapReason,
  type CoverageCap,
  type CoveragePolicy,
  type CoverageResult,
  type EligibleCoverage,
  type EligibleEntry,
  eligibilityKey,
  eligibleCoverage,
  entryInstants,
  type EntryInstants,
  graceElapsed,
  type SourceCoverage,
  type SourceGrace,
} from './conditions-coverage';
export { type CalendarBound, calendarBound, coverageLevel } from './conditions-level';
export { type Finality, type FinalityInput, isFinalizable } from './conditions-finality';
export {
  type AllowlistCheck,
  amountAboveCeiling,
  type CeilingCheck,
  countedInSpendCurrency,
  counterpartyNotAllowed,
  cumulativeAboveCeiling,
  type CumulativeCheck,
  observedScopeExceedsDeclared,
  type ScopePolicy,
  spendCurrencyOf,
  targetMissing,
  typeNotInGrant,
  unaskedLikely,
  unaskedLikelyAt,
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
  /**
   * `eligibleCoverage(claim, grant, coverage, policy)` when the caller already has it (a batch shares one per grant
   * and eligibility key, conditions-coverage.ts `eligibilityKey`); computed on first use otherwise.
   */
  readonly eligible?: EligibleCoverage;
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

/** A condition not evaluated yet: each is evaluated at most once per grading (a throw leaves it unevaluated). */
const NOT_YET: unique symbol = Symbol('not yet');
type Lazy<T> = T | typeof NOT_YET;

/** Claim-less (§6.1): only `unaskedLikely` and `observedScopeExceedsDeclared` apply; every other is null. */
class ClaimlessConditions implements Conditions {
  #unasked: Lazy<boolean | null> = NOT_YET;
  #scope: Lazy<boolean | null> = NOT_YET;

  constructor(readonly facts: ConditionFacts) {}

  unaskedLikely(): boolean | null {
    if (this.#unasked === NOT_YET) this.#unasked = unaskedLikely(this.facts.context, this.facts.policy);
    return this.#unasked;
  }

  observedScopeExceedsDeclared(): boolean | null {
    if (this.#scope === NOT_YET)
      this.#scope = observedScopeExceedsDeclared(this.facts.grant, this.facts.context);
    return this.#scope;
  }

  eligible = notApplicable;
  typeNotInGrant = notApplicable;
  counterpartyNotAllowed = notApplicable;
  amountAboveCeiling = notApplicable;
  cumulativeAboveCeiling = notApplicable;
  targetMissing = notApplicable;
  underspecified = notApplicable;
  coverage = notApplicable;
  graceElapsed = notApplicable;
  bestScoreGte = notApplicable;
  bestScoreLt = notApplicable;
}

/** A condition that does not apply to this grading (§6.1). */
function notApplicable(): null {
  return null;
}

/** With a claim (§6.1): every condition but the two claim-less ones applies, each evaluated at most once. */
class ClaimConditions implements Conditions {
  #eligible: Lazy<EligibleCoverage>;
  #typeNotInGrant: Lazy<boolean> = NOT_YET;
  #allowlist: Lazy<AllowlistCheck | null> = NOT_YET;
  #ceiling: Lazy<CeilingCheck | null> = NOT_YET;
  #cumulative: Lazy<CumulativeCheck | null> = NOT_YET;
  #underspecified: Lazy<boolean> = NOT_YET;
  #coverage: Lazy<CoverageResult> = NOT_YET;
  #grace: Lazy<readonly SourceGrace[]> = NOT_YET;
  #scored: Lazy<boolean> = NOT_YET;

  constructor(
    readonly claim: Claim,
    readonly facts: ConditionFacts,
  ) {
    this.#eligible = facts.eligible ?? NOT_YET;
  }

  eligible(): EligibleCoverage {
    const { grant, coverage, policy } = this.facts;
    if (this.#eligible === NOT_YET) this.#eligible = eligibleCoverage(this.claim, grant, coverage, policy);
    return this.#eligible;
  }

  unaskedLikely = notApplicable;
  observedScopeExceedsDeclared = notApplicable;

  typeNotInGrant(): boolean {
    if (this.#typeNotInGrant === NOT_YET) this.#typeNotInGrant = typeNotInGrant(this.claim, this.facts.grant);
    return this.#typeNotInGrant;
  }

  counterpartyNotAllowed(): AllowlistCheck | null {
    const { assigned, grant, policy } = this.facts;
    if (this.#allowlist === NOT_YET)
      this.#allowlist = counterpartyNotAllowed(this.claim, assigned, grant, policy);
    return this.#allowlist;
  }

  amountAboveCeiling(): CeilingCheck | null {
    const { assigned, grant, policy } = this.facts;
    if (this.#ceiling === NOT_YET) this.#ceiling = amountAboveCeiling(this.claim, assigned, grant, policy);
    return this.#ceiling;
  }

  cumulativeAboveCeiling(): CumulativeCheck | null {
    const { grant, context, policy } = this.facts;
    if (this.#cumulative === NOT_YET)
      this.#cumulative = cumulativeAboveCeiling(this.claim, grant, context, policy);
    return this.#cumulative;
  }

  targetMissing(): boolean {
    return targetMissing(this.claim);
  }

  underspecified(): boolean {
    if (this.#underspecified === NOT_YET)
      this.#underspecified = isUnderspecified(this.claim, this.facts.policy);
    return this.#underspecified;
  }

  coverage(): CoverageResult {
    if (this.#coverage === NOT_YET) {
      const { policy } = this.facts;
      this.#coverage = coverageFrom(
        this.eligible(),
        claimWindow(this.claim, policy),
        calendarBound(this.claim, policy),
        graceSyncMs(this.claim, policy),
      );
    }
    return this.#coverage;
  }

  graceElapsed(): readonly SourceGrace[] {
    if (this.#grace === NOT_YET)
      this.#grace = syncedSources(this.eligible(), graceSyncMs(this.claim, this.facts.policy));
    return this.#grace;
  }

  /**
   * §4.3: whether the claim is scored against observations at all (features.ts `isAssignable`). An underspecified
   * claim, a calendar claim without `targetAt` and a type with no sources never are, so no score condition applies
   * to them: "nothing matched at the threshold" would be asserted of a claim nothing was matched against, and a
   * rule order that tests `bestScoreLt` before `underspecified` could reach NOT_FOUND (Hard Rule 5).
   */
  #isScored(): boolean {
    if (this.#scored === NOT_YET) this.#scored = isAssignable(this.claim, this.facts.policy);
    return this.#scored;
  }

  bestScoreGte(threshold: ThresholdName): boolean | null {
    const { bestScore, policy } = this.facts;
    if (!this.#isScored()) return null;
    return bestScore !== null && ratioGteBasisPoints(bestScore, policy.bp.thresholds[threshold]);
  }

  bestScoreLt(threshold: ThresholdName): boolean | null {
    const gte = this.bestScoreGte(threshold);
    return gte === null ? null : !gte;
  }
}

/** The §6.1 evaluators for one grading. */
export function evaluateConditions(facts: ConditionFacts): Conditions {
  return facts.claim === null ? new ClaimlessConditions(facts) : new ClaimConditions(facts.claim, facts);
}

function valueOf(check: { readonly value: boolean } | null): boolean | null {
  return check === null ? null : check.value;
}

function graceValue(sources: readonly SourceGrace[] | null): boolean | null {
  return sources === null ? null : sources.every((source) => source.elapsed);
}

/** A rule's `when` with every condition key present (absent ones `undefined`): one shape for every rule. */
type UniformWhen = { readonly [K in keyof RuleWhen]-?: RuleWhen[K] | undefined };

/**
 * §6.1: a rule matches iff every condition its `when` names is applicable and holds (a flag holds iff it is
 * applicable and has the written value). Conditions are evaluated in this order and only as far as needed.
 */
export function ruleMatches(when: RuleWhen | UniformWhen, c: Conditions): boolean {
  return (
    (when.unaskedLikely === undefined || c.unaskedLikely() === when.unaskedLikely) &&
    (when.observedScopeExceedsDeclared === undefined ||
      c.observedScopeExceedsDeclared() === when.observedScopeExceedsDeclared) &&
    (when.typeNotInGrant === undefined || c.typeNotInGrant() === when.typeNotInGrant) &&
    (when.counterpartyNotAllowed === undefined ||
      valueOf(c.counterpartyNotAllowed()) === when.counterpartyNotAllowed) &&
    (when.amountAboveCeiling === undefined || valueOf(c.amountAboveCeiling()) === when.amountAboveCeiling) &&
    (when.cumulativeAboveCeiling === undefined ||
      valueOf(c.cumulativeAboveCeiling()) === when.cumulativeAboveCeiling) &&
    (when.targetMissing === undefined || c.targetMissing() === when.targetMissing) &&
    (when.underspecified === undefined || c.underspecified() === when.underspecified) &&
    (when.coverage === undefined || c.coverage()?.level === when.coverage) &&
    (when.bestScoreGte === undefined || c.bestScoreGte(when.bestScoreGte) === true) &&
    (when.bestScoreLt === undefined || c.bestScoreLt(when.bestScoreLt) === true) &&
    (when.graceElapsed === undefined || graceValue(c.graceElapsed()) === when.graceElapsed)
  );
}

function uniform(when: RuleWhen): UniformWhen {
  return {
    unaskedLikely: when.unaskedLikely,
    observedScopeExceedsDeclared: when.observedScopeExceedsDeclared,
    typeNotInGrant: when.typeNotInGrant,
    counterpartyNotAllowed: when.counterpartyNotAllowed,
    amountAboveCeiling: when.amountAboveCeiling,
    cumulativeAboveCeiling: when.cumulativeAboveCeiling,
    targetMissing: when.targetMissing,
    underspecified: when.underspecified,
    coverage: when.coverage,
    bestScoreGte: when.bestScoreGte,
    bestScoreLt: when.bestScoreLt,
    graceElapsed: when.graceElapsed,
  };
}

/**
 * Each rule's `when` in one shape (`UniformWhen`), remembered only for the `rules` array of a policy `loadPolicy`
 * returned (policy.ts `isLoadedRules`): deep-frozen plain data the loader built, so nothing the copies were made
 * from can change. Any other array (a copy, a hand-built list, a frozen one whose `when` is an accessor) is read
 * afresh on every call, so a memo never changes a result (Hard Rule 4).
 */
const UNIFORM_WHENS = new WeakMap<readonly PolicyRule[], readonly UniformWhen[]>();

function uniformWhens(rules: readonly PolicyRule[]): readonly UniformWhen[] {
  const held = UNIFORM_WHENS.get(rules);
  if (held !== undefined) return held;
  const whens = rules.map((rule) => uniform(rule.when));
  if (isLoadedRules(rules)) UNIFORM_WHENS.set(rules, whens);
  return whens;
}

/** §6: the first rule in policy order whose conditions all hold, or null (terminal `default_unverifiable`). */
export function firstMatch(rules: readonly PolicyRule[], c: Conditions): PolicyRule | null {
  const whens = uniformWhens(rules);
  for (let i = 0; i < rules.length; i += 1) {
    const when = whens[i];
    if (when !== undefined && ruleMatches(when, c)) return rules[i] ?? null;
  }
  return null;
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
