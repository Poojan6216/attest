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
 * A claim's candidates are checked first (grade-guard.ts): one that `candidates()` could never have returned for it
 * (another type, a source the policy does not list for the type, outside the window, a `calendar.created` event
 * seen before the claim) throws `GradeError('foreign_candidate')`.
 *
 * Claim-less grades have exactly one subject: one orphan observation (UNASKED, `{k:'unasked'}`) or
 * `context.scope` (scope diff, `{k:'scope'}`); anything else throws `GradeError('claimless_subject')`. A
 * claim-less outcome other than UNASKED or OVER_SCOPE is the terminal `default_unverifiable`, FINAL (§8). The grant
 * must be the claim's agent's (or, claim-less, the attributed agent's), else `GradeError('agent_mismatch')`.
 * `grade`, `gradeOrphan` and `gradeClaim` refuse a policy `loadPolicy` did not return with
 * `PolicyError('policy_not_loaded')` before reading anything (Hard Rule 6).
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
import { checkCandidates } from './grade-guard';
import { confidenceOf, gradeReasons } from './grade-reasons';
import {
  assertLoadedPolicy,
  type Policy,
  type PolicyRule,
  type RuleOutcome,
  TERMINAL_RULE_ID,
} from './policy';
import {
  buildReceipt,
  candidatesHashById,
  coverageHash,
  grantHash,
  inputsHashOf,
  type ReceiptSubject,
} from './receipt';
import type { Claim, Coverage, Grade, GradeContext, Grant, Observation, Receipt, Sha256 } from './schema';

export { GradeError, type GradeErrorCode } from './grade-error';

interface Subject {
  readonly subject: ReceiptSubject;
  /** The orphan observation of an UNASKED subject. */
  readonly orphan: Observation | null;
}

/**
 * What a claim's grading reads of its candidates and coverage, derived either by `grade` itself or by a batch
 * from its own tables (batch-grade.ts), which must give exactly what `grade` derives for the same inputs.
 */
export interface ClaimEvidence {
  /** The coverage as `grade` sees it (§3: entries synced by `evaluatedAt`; grade-best.ts `visibleCoverage`). */
  readonly coverage: Coverage;
  /** The best candidate of the visible candidates (grade-best.ts `bestCandidate`), or null. */
  readonly best: BestCandidate | null;
  /** §3 `candidatesHash` of the visible candidates (one per id, in id order), read when the receipt is hashed. */
  readonly candidatesHash: () => string;
  /** `grantHash(grant)` and `coverageHash(coverage)` when the caller keeps them (§3: once per batch). */
  readonly grantHash?: () => Sha256;
  readonly coverageHash?: () => Sha256;
  /** The claim's eligible coverage when the caller has it (conditions.ts `ConditionFacts.eligible`). */
  readonly eligible?: EligibleCoverage;
}

/** The evidence of any grading: a claim's, or a claim-less one's (no best candidate). */
interface Evidence extends ClaimEvidence {
  readonly subject: Subject;
}

/** The decision, before it is written as a receipt. */
interface Decision {
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
  evidence: Evidence,
  grant: Grant,
  policy: Policy,
  context: GradeContext,
): Decision {
  const { best, coverage } = evidence;
  const assigned = assignedOf(best, policy);
  const bestScore = best?.score ?? null;
  const facts = { claim, grant, policy, coverage, context, bestScore, assigned };
  const conditions = evaluateConditions(
    evidence.eligible === undefined ? facts : { ...facts, eligible: evidence.eligible },
  );
  const rule = claimlessRule(claim, firstMatch(policy.rules, conditions));
  return { assigned, conditions, rule, outcome: rule?.then ?? 'UNVERIFIABLE' };
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

/**
 * §8: an OVER_SCOPE outcome waits for grace like PARTIAL only when it "would not be OVER_SCOPE without that
 * candidate's amount, currency or address": the matched rule rested on the candidate (`candidateDependent`) and,
 * graded with no candidate at all, the first matching rule does not conclude OVER_SCOPE. A claim-only fact that a
 * later rule names (cumulative spend, say) keeps it OVER_SCOPE whatever evidence arrives, so it is FINAL at once.
 * Only OVER_SCOPE reads this (conditions-finality.ts).
 */
function waitsForCandidate(
  claim: Claim | null,
  evidence: Evidence,
  decision: Decision,
  grant: Grant,
  policy: Policy,
  context: GradeContext,
): boolean {
  const { rule, conditions } = decision;
  if (claim === null || decision.outcome !== 'OVER_SCOPE' || rule === null) return false;
  if (!candidateDependent(rule.when, conditions)) return false;
  const facts = {
    claim,
    grant,
    policy,
    coverage: evidence.coverage,
    context,
    bestScore: null,
    assigned: null,
  };
  const without = evaluateConditions({ ...facts, ...eligibleOf(conditions) });
  return firstMatch(policy.rules, without)?.then !== 'OVER_SCOPE';
}

/** §6, §8, §3: decides one grading from its evidence and writes the receipt. */
function judge(
  claim: Claim | null,
  evidence: Evidence,
  grant: Grant,
  policy: Policy,
  context: GradeContext,
): Receipt {
  const { coverage, best } = evidence;
  const { orphan } = evidence.subject;
  const decision = decide(claim, evidence, grant, policy, context);
  const { rule, outcome, conditions } = decision;
  const { final } = isFinalizable({
    outcome,
    rule,
    claim,
    orphan,
    grant,
    coverage,
    context,
    policy,
    candidateDependent: waitsForCandidate(claim, evidence, decision, grant, policy, context),
    ...eligibleOf(conditions),
  });
  const receiptGrade: Grade = outcome === 'PENDING' ? 'UNVERIFIABLE' : outcome;
  return buildReceipt({
    subject: evidence.subject.subject,
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
    inputsHash: inputsHashOf({
      claim,
      candidatesHash: evidence.candidatesHash(),
      grantHash: evidence.grantHash?.() ?? grantHash(grant),
      policyHash: policy.policyHash,
      coverageHash: evidence.coverageHash?.() ?? coverageHash(coverage),
      context,
    }),
    computedAt: coverage.evaluatedAt,
  });
}

/**
 * §6: grades one claim (or one orphan, or one observed scope) against its evidence. A claim's candidates must be
 * §4.1 candidates of it, else `GradeError('foreign_candidate')` (grade-guard.ts).
 */
export function grade(
  claim: Claim | null,
  candidates: readonly Observation[],
  grant: Grant,
  policy: Policy,
  coverage: Coverage,
  context: GradeContext,
): Receipt {
  assertLoadedPolicy(policy);
  checkAgents(claim, grant, context);
  // A scope subject comes with no observation at all: one first seen after evaluatedAt is a second subject too.
  if (claim === null && context.scope !== undefined && candidates.length > 0) {
    throw new GradeError('claimless_subject');
  }
  if (claim !== null) checkCandidates(claim, candidates, policy);
  const visible = visibleInputs(candidates, coverage);
  const subject = subjectOf(claim, visible.candidates, grant, context);
  const best = claim === null ? null : bestCandidate(claim, visible.candidates, policy);
  const candidatesHash = () => candidatesHashById(visible.byId);
  const evidence = { coverage: visible.coverage, subject, best, candidatesHash };
  return judge(claim, evidence, grant, policy, context);
}

/** The evidence every grading of a batch shares: what `grade` derives from the coverage and the grant alone. */
export type SharedEvidence = Pick<ClaimEvidence, 'coverage' | 'grantHash' | 'coverageHash'>;

/**
 * `grade(null, [orphan], grant, policy, coverage, context)` for an orphan a batch read from its index as of
 * `coverage.evaluatedAt` (so `grade` would see it), with the evidence the batch shares (`SharedEvidence`).
 */
export function gradeOrphan(
  orphan: Observation,
  shared: SharedEvidence,
  grant: Grant,
  policy: Policy,
  context: GradeContext,
): Receipt {
  assertLoadedPolicy(policy);
  checkAgents(null, grant, context);
  const subject = subjectOf(null, [orphan], grant, context);
  const candidatesHash = (): string => candidatesHashById([orphan]);
  return judge(null, { ...shared, best: null, candidatesHash, subject }, grant, policy, context);
}

/**
 * `grade(claim, candidates, grant, policy, coverage, context)` for a claim whose evidence (`ClaimEvidence`) a batch
 * derived from the same inputs (batch-grade.ts; the perf gate and batch tests pin the two together).
 */
export function gradeClaim(
  claim: Claim,
  evidence: ClaimEvidence,
  grant: Grant,
  policy: Policy,
  context: GradeContext,
): Receipt {
  assertLoadedPolicy(policy);
  checkAgents(claim, grant, context);
  const subject: Subject = { subject: { k: 'claim', claimId: claim.id }, orphan: null };
  return judge(claim, { ...evidence, subject }, grant, policy, context);
}
