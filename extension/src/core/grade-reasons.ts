/**
 * Reasons and confidence of a graded receipt (docs/grading.md §6.4, §15). Internal to grade.ts.
 *
 * Emission (§15):
 *  - the RULE's own codes come from the conditions its `when` names that held: `unaskedLikely` → the attributed
 *    agent's fired `unasked.*` signals (UNASKED only; attribution.ts `attributionReasons`, the one map from
 *    signal to code); `observedScopeExceedsDeclared` → `scope.observed_not_
 *    declared`; `typeNotInGrant` → `scope.type_not_allowed`; `counterpartyNotAllowed` →
 *    `scope.counterparty_not_allowed`; `amountAboveCeiling` → `ceiling.exceeded` and/or
 *    `ceiling.currency_mismatch`; `cumulativeAboveCeiling` → `ceiling.cumulative_exceeded`; `targetMissing` →
 *    `claim.no_target`; `underspecified` → `claim.too_vague`; `coverage: none` → `coverage.none` per source;
 *    `coverage: partial` → `coverage.partial` per source not fully covered; a PENDING outcome → `grace.waiting`
 *    per source still in grace, replaced by `coverage.never_completed` once it finalises by time. So the
 *    `verified`, `partial`, `not_found` and `default_unverifiable` rules add no rule code;
 *  - `allowlist.unchecked` when `counterpartyNotAllowed` was not applicable and the grade is not OVER_SCOPE;
 *  - coverage reasons: the capping codes (each with the `source` it capped, `coverage.no_parser` included) only
 *    when the rule names `coverage: partial`; `coverage.account_unbound` on NOT_FOUND, per relevant source with no
 *    `grant.accounts` binding;
 *  - `match.best` (or `match.none` when nothing was scored) and the best candidate's `cp.*`, on claim receipts
 *    only.
 * Params are ids, hashes, enum values and integers only (§6.4): never an address, a name or a subject.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { attributionReasons } from './attribution';
import type { CeilingCheck, Conditions, CoverageResult, SourceGrace } from './conditions';
import type { BestCandidate } from './grade-best';
import { sha256Hex } from './hash';
import type { Policy, PolicyRule, RuleOutcome } from './policy';
import { toDisplay, toDisplayOf } from './ratio';
import { reasonCode, type ReasonGroups } from './receipt';
import type { Claim, Grade, GradeContext, Grant, Reason, ReasonCode } from './schema';
import { BASIS_POINTS } from './units';

export interface ReasonInput {
  readonly claim: Claim | null;
  /** The matched rule, or null for the terminal rule. */
  readonly rule: PolicyRule | null;
  readonly outcome: RuleOutcome;
  readonly final: boolean;
  /** The receipt grade (UNVERIFIABLE for a PENDING outcome). */
  readonly grade: Grade;
  readonly conditions: Conditions;
  readonly best: BestCandidate | null;
  readonly grant: Grant;
  readonly context: GradeContext;
  readonly policy: Policy;
}

/**
 * A numeric param of `-0` (a parsed amount or `priorSpendCents` may be one: `min(0)` accepts it) is written as
 * `0`. Canonical JSON (§10) hashes the two alike, so without this two inputs with one `inputsHash` could give
 * receipts that differ under `Object.is` and in IndexedDB (Hard Rule 4).
 */
function plainZero(value: string | number): string | number {
  return Object.is(value, -0) ? 0 : value;
}

function reason(code: ReasonCode, params: Reason['params'] = {}): Reason {
  const plain: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) plain[key] = plainZero(value);
  return { code, params: plain };
}

/** One reason per source in `sources`, or one without params for a type with no sources (§15). */
function perSource(code: ReasonCode, sources: readonly string[], hasSources: boolean): Reason[] {
  if (!hasSources) return [reason(code)];
  return sources.map((source) => reason(code, { source }));
}

function ceilingReasons(check: CeilingCheck | null): Reason[] {
  if (check === null) return [];
  const out: Reason[] = [];
  if (check.exceeded && check.amountCents !== undefined) {
    out.push(
      reason('ceiling.exceeded', { amountCents: check.amountCents, ceilingCents: check.ceilingCents }),
    );
  }
  if (check.mismatchCurrency !== undefined) {
    const params = { currency: check.mismatchCurrency, spendCurrency: check.spendCurrency };
    out.push(reason('ceiling.currency_mismatch', params));
  }
  return out;
}

/** The permission codes of the matched rule (§15), from the conditions its `when` names. */
function permissionReasons(input: ReasonInput, when: PolicyRule['when']): Reason[] {
  const { claim, conditions: c, context } = input;
  const out: Reason[] = [];
  const attribution = context.attribution;
  if (when.unaskedLikely === true && input.outcome === 'UNASKED' && attribution !== undefined) {
    out.push(...attributionReasons(attribution));
  }
  if (when.observedScopeExceedsDeclared === true && context.scope !== undefined) {
    out.push(reason('scope.observed_not_declared', { scopeHash: sha256Hex(context.scope.observed) }));
  }
  if (when.typeNotInGrant === true && claim !== null) {
    out.push(reason('scope.type_not_allowed', { type: claim.type }));
  }
  if (when.counterpartyNotAllowed === true) out.push(reason('scope.counterparty_not_allowed'));
  if (when.amountAboveCeiling === true) out.push(...ceilingReasons(c.amountAboveCeiling()));
  const cumulative = when.cumulativeAboveCeiling === true ? c.cumulativeAboveCeiling() : null;
  if (cumulative !== null) {
    const { priorSpendCents, amountCents, ceilingCents } = cumulative;
    out.push(reason('ceiling.cumulative_exceeded', { priorSpendCents, amountCents, ceilingCents }));
  }
  if (when.targetMissing === true) out.push(reason('claim.no_target'));
  if (when.underspecified === true) out.push(reason('claim.too_vague'));
  return out;
}

function levelReasons(when: PolicyRule['when'], coverage: CoverageResult | null): Reason[] {
  if (coverage === null || when.coverage === undefined || when.coverage === 'full') return [];
  const hasSources = coverage.sources.length > 0;
  if (when.coverage === 'none') {
    return perSource(
      'coverage.none',
      coverage.sources.map(({ source }) => source),
      hasSources,
    );
  }
  const short = coverage.sources.filter(({ level }) => level !== 'full').map(({ source }) => source);
  return perSource('coverage.partial', short, hasSources);
}

function pendingReasons(input: ReasonInput, when: PolicyRule['when']): Reason[] {
  if (input.outcome !== 'PENDING') return [];
  if (input.final) return [reason('coverage.never_completed')];
  if (when.graceElapsed !== false) return [];
  const waiting = (input.conditions.graceElapsed() ?? []).filter((source: SourceGrace) => !source.elapsed);
  return waiting.map(({ source }) => reason('grace.waiting', { source }));
}

function ruleReasons(input: ReasonInput): Reason[] {
  const when = input.rule?.when;
  if (when === undefined) return [];
  return [
    ...permissionReasons(input, when),
    ...levelReasons(when, input.conditions.coverage()),
    ...pendingReasons(input, when),
  ];
}

/** Coverage-group reasons: the caps behind a `coverage: partial` rule, and `account_unbound` on NOT_FOUND. */
function coverageReasons(input: ReasonInput): Reason[] {
  const { claim, rule, grant, policy } = input;
  if (claim === null) return [];
  const out: Reason[] = [];
  if (rule?.when.coverage === 'partial') {
    for (const cap of input.conditions.coverage()?.capReasons ?? []) {
      out.push(reason(reasonCode(cap.code), { source: cap.source }));
    }
  }
  if (input.grade === 'NOT_FOUND') {
    const unbound = policy.sourcesByType[claim.type].filter(
      (source) => grant.accounts?.[source] === undefined,
    );
    out.push(...unbound.map((source) => reason('coverage.account_unbound', { source })));
  }
  return out;
}

function matchReasons(input: ReasonInput): Reason[] {
  const { claim, best } = input;
  if (claim === null) return [];
  if (best === null) return [reason('match.none')];
  return [
    reason('match.best', { observationId: best.observation.id }),
    ...best.reasonCodes.map((code) => reason(code)),
  ];
}

/** §15: every reason of the receipt, by group (receipt.ts orders them). */
export function gradeReasons(input: ReasonInput): ReasonGroups {
  const uncheckable = input.claim !== null && input.conditions.counterpartyNotAllowed() === null;
  return {
    rule: ruleReasons(input),
    allowlist: uncheckable && input.grade !== 'OVER_SCOPE' ? [reason('allowlist.unchecked')] : [],
    coverage: coverageReasons(input),
    match: matchReasons(input),
  };
}

/**
 * §6.4 confidence (a display number, never compared): VERIFIED/PARTIAL the best score, NOT_FOUND and OVER_SCOPE 1,
 * UNASKED the attribution score, UNVERIFIABLE 0.
 */
export function confidenceOf(grade: Grade, best: BestCandidate | null, context: GradeContext): number {
  switch (grade) {
    case 'VERIFIED':
    case 'PARTIAL':
      return best === null ? 0 : toDisplay(best.score);
    case 'NOT_FOUND':
    case 'OVER_SCOPE':
      return 1;
    case 'UNASKED':
      return context.attribution === undefined ? 0 : toDisplayOf(context.attribution.scoreBp, BASIS_POINTS);
    case 'UNVERIFIABLE':
      return 0;
  }
}
