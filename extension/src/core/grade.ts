/**
 * `grade()`: the decision function (docs/grading.md §3, §6, §8; module contract §13 `grade.ts`; Hard Rule 4).
 *
 *   grade(claim | null, candidates, grant, policy, coverage, context) → Receipt
 *
 * Pure and deterministic: the receipt depends only on the inputs (as sets, wherever an input is a set), so the
 * same inputs give the same receipt forever and `inputsHash` proves it on replay.
 *
 *  1. What it sees (§3): coverage entries with `lastSyncAt > evaluatedAt` and candidates with `observedAt >
 *     evaluatedAt` are dropped; candidates are one per id and ordered by (`occurredAt` instant, id).
 *  2. Score (§5): an assignable claim's candidates through `features()`; the best is the highest exact score,
 *     ties by observation id. It is ASSIGNED (named in `observationIds`) iff its score ≥ `thresholds.partial`.
 *  3. Rules (§6): `policy.rules`, first match wins; nothing matches → terminal `default_unverifiable`
 *     (UNVERIFIABLE). A PENDING outcome is stored as grade UNVERIFIABLE (the placeholder, §2), rule `pending`.
 *  4. Finality (§8): `isFinalizable` in conditions.ts sets `state` and `finalAt`.
 *  5. Receipt (§3, §6.4, §8, §15): id from the subject, reasons in §15 order, confidence, signals, `computedAt =
 *     coverage.evaluatedAt`, `attribution: 'likely'` on UNASKED.
 *
 * Claim-less grades have exactly one subject: one orphan observation (UNASKED, `{k:'unasked'}`) or
 * `context.scope` (scope diff, `{k:'scope'}`); anything else throws `GradeError('claimless_subject')`. A
 * claim-less outcome other than UNASKED or OVER_SCOPE is the terminal `default_unverifiable`, FINAL (§8). The grant
 * must be the claim's agent's (or, claim-less, the attributed agent's), else `GradeError('agent_mismatch')`.
 *
 * PURE: no I/O, no clock, no randomness, no logging (Hard Rule 4).
 */
import {
  candidateDependent,
  type Conditions,
  type EligibleCoverage,
  evaluateConditions,
  firstMatch,
  isFinalizable,
} from './conditions';
import { assignedOf, type BestCandidate, bestCandidate, visibleInputs } from './grade-best';
import { GradeError } from './grade-error';
import { confidenceOf, gradeReasons } from './grade-reasons';
import { type Policy, type PolicyRule, type RuleOutcome, TERMINAL_RULE_ID } from './policy';
import { buildReceipt, inputsHash, type ReceiptSubject } from './receipt';
import type { Claim, Coverage, Grade, GradeContext, Grant, Observation, Receipt } from './schema';

export { GradeError, type GradeErrorCode } from './grade-error';

interface Subject {
  readonly subject: ReceiptSubject;
  /** The orphan observation of an UNASKED subject. */
  readonly orphan: Observation | null;
}

/** The decision, before it is written as a receipt. */
interface Decision {
  readonly best: BestCandidate | null;
  readonly assigned: Observation | null;
  readonly conditions: Conditions;
  readonly rule: PolicyRule | null;
  readonly outcome: RuleOutcome;
}

function checkAgents(claim: Claim | null, grant: Grant, context: GradeContext): void {
  const agent = claim === null ? context.attribution?.agent : claim.agent;
  if (agent !== undefined && agent !== grant.agent) throw new GradeError('agent_mismatch');
}

/** §3: a claim receipt's subject is its claim; a claim-less one's is its single orphan or its scope. */
function subjectOf(
  claim: Claim | null,
  candidates: readonly Observation[],
  grant: Grant,
  context: GradeContext,
): Subject {
  if (claim !== null) return { subject: { k: 'claim', claimId: claim.id }, orphan: null };
  const [orphan, ...rest] = candidates;
  if (context.scope === undefined && orphan !== undefined && rest.length === 0) {
    return { subject: { k: 'unasked', observationId: orphan.id }, orphan };
  }
  if (context.scope !== undefined && orphan === undefined) {
    return { subject: { k: 'scope', agent: grant.agent, scope: context.scope.observed }, orphan: null };
  }
  throw new GradeError('claimless_subject');
}

/** The only outcomes a claim-less grade may reach (§3: UNASKED and `over_scope_observed` receipts). */
const CLAIMLESS_OUTCOMES: ReadonlySet<RuleOutcome> = new Set(['UNASKED', 'OVER_SCOPE']);

/**
 * §8: a claim-less grade whose outcome is neither UNASKED nor OVER_SCOPE returns the terminal rule
 * `default_unverifiable` (FINAL), whatever rule a policy wrote for it: with no claim there is no window, so a
 * claim-less NOT_FOUND, VERIFIED, PARTIAL or PENDING would claim sight Attest never had (Hard Rule 5).
 */
function claimlessRule(claim: Claim | null, rule: PolicyRule | null): PolicyRule | null {
  if (claim !== null || rule === null) return rule;
  return CLAIMLESS_OUTCOMES.has(rule.then) ? rule : null;
}

function decide(
  claim: Claim | null,
  candidates: readonly Observation[],
  grant: Grant,
  policy: Policy,
  coverage: Coverage,
  context: GradeContext,
): Decision {
  const best = claim === null ? null : bestCandidate(claim, candidates, policy);
  const assigned = assignedOf(best, policy);
  const bestScore = best?.score ?? null;
  const conditions = evaluateConditions({ claim, grant, policy, coverage, context, bestScore, assigned });
  const rule = claimlessRule(claim, firstMatch(policy.rules, conditions));
  return { best, assigned, conditions, rule, outcome: rule?.then ?? 'UNVERIFIABLE' };
}

/** §8: the assigned candidate of a claim receipt; an UNASKED receipt's orphan; otherwise none. */
function observationIdsOf(decision: Decision, grade: Grade, orphan: Observation | null): Observation['id'][] {
  if (decision.assigned !== null) return [decision.assigned.id];
  return grade === 'UNASKED' && orphan !== null ? [orphan.id] : [];
}

/** The eligible coverage the conditions already computed, so finality does not compute it again. */
function eligibleOf(conditions: Conditions): { eligible?: EligibleCoverage } {
  const eligible = conditions.eligible();
  return eligible === null ? {} : { eligible };
}

/** §6: grades one claim (or one orphan, or one observed scope) against its evidence. */
export function grade(
  claim: Claim | null,
  candidates: readonly Observation[],
  grant: Grant,
  policy: Policy,
  coverage: Coverage,
  context: GradeContext,
): Receipt {
  checkAgents(claim, grant, context);
  const visible = visibleInputs(candidates, coverage);
  const { subject, orphan } = subjectOf(claim, visible.candidates, grant, context);
  const decision = decide(claim, visible.candidates, grant, policy, visible.coverage, context);
  const { rule, outcome, conditions, best } = decision;
  const { final } = isFinalizable({
    outcome,
    rule,
    claim,
    orphan,
    grant,
    coverage: visible.coverage,
    context,
    policy,
    candidateDependent: rule !== null && candidateDependent(rule.when, conditions),
    ...eligibleOf(conditions),
  });
  const receiptGrade: Grade = outcome === 'PENDING' ? 'UNVERIFIABLE' : outcome;
  return buildReceipt({
    subject,
    agent: claim?.agent ?? grant.agent,
    claim,
    observationIds: observationIdsOf(decision, receiptGrade, orphan),
    grade: receiptGrade,
    confidence: confidenceOf(receiptGrade, best, context),
    ruleId: rule?.id ?? TERMINAL_RULE_ID,
    reasons: gradeReasons({
      claim,
      rule,
      outcome,
      final,
      grade: receiptGrade,
      conditions,
      best,
      grant,
      context,
      policy,
    }),
    signals: best?.signals ?? {},
    final,
    policyHash: policy.policyHash,
    inputsHash: inputsHash({ ...visible, claim, grant, policyHash: policy.policyHash, context }),
    computedAt: coverage.evaluatedAt,
  });
}
