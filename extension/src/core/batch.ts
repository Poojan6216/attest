/**
 * Batch grading (docs/grading.md §3, §4.3, §6.3, §7; module contract §13 `batch.ts`). `gradeBatch` is the only
 * path from the background to receipts: it grades exactly the PENDING `claims` it is given, with FINAL and
 * USER_OVERRIDDEN claims as fixed pre-assignments, and returns each receipt with the inputs it was graded with
 * (`{receipt, inputs: {grant, context, policyHash}}`; the coverage is the batch's own), so the caller can store
 * `receiptInputs` for replay (§3, §9):
 *
 *  - one receipt per claim: candidates are retrieved and scored for every assignable claim (§4.3: never for an
 *    underspecified claim, a calendar claim without `targetAt`, or a type with no sources), observations are
 *    assigned one-to-one (fixed pairs first, then best score first), and `grade` sees the claim's candidates
 *    minus those assigned to other claims or fixed as taken, with `priorSpendCents` read from
 *    `activity.claims` (§6.3, which holds FINAL and USER_OVERRIDDEN claims too) plus any graded claim it omits
 *    (`historyOf`), a missing currency read as the grant's `spendCurrency`;
 *  - one UNASKED receipt per orphan that `grade` calls UNASKED: an observation of a covered type in a window
 *    its own source's observer saw, assigned to no claim and not taken, attributed with `attributor` (§7);
 *  - one OVER_SCOPE receipt per observed scope of a grant in force that `grade` calls OVER_SCOPE (rule
 *    `over_scope_observed`). A claim-less grade with any other outcome yields no receipt (§3).
 *
 * Inputs from after `coverage.evaluatedAt` are ignored (§3): observations first seen later (`visibleAt`),
 * coverage synced later (`seenWindows`; `grade` applies the same rule to eligibility), grants written later
 * (`grantsInForce`) and claims first seen later (`claimsSeenBy`: neither graded, nor given evidence, nor counted
 * in `priorSpendCents`); attribution.ts cuts the activity it reads at `evaluatedAt` itself (`attributor`). The
 * output is ordered by receipt id, so it never depends on input order or index return order. It stores nothing:
 * the caller replaces each subject's row (§3).
 *
 * Speed (the task 1.5 grading perf gate): each type's rows are read once into a table (batch-retrieve.ts,
 * batch-table.ts), every pair is scored once (batch-score.ts), and each claim's evidence (best candidate,
 * `candidatesHash`, coverage) is derived from those tables and handed to `gradeClaim`, which decides exactly as
 * `grade` does (batch-grade.ts; the gate and batch-tables.spec.ts check receipts against `grade`). Claims are read
 * through copies of one object shape (`uniformClaim`), so the code reading them is compiled for one shape.
 *
 * PURE: no I/O but the injected index, no clock, no logging (Hard Rule 4). Async only because the index is.
 */
import { BatchError } from './batch-error';
import { BatchEvidence, type BatchInputs, type BatchReceipt, claimReceipts } from './batch-grade';
import { grantOf, grantsInForce } from './batch-grants';
import { coveredObservations, type Keyed, visibleAt } from './batch-orphans';
import { candidatesOfAll } from './batch-retrieve';
import { assignablePairs, type ScoredClaim, scoreClaim } from './batch-score';
import { attributor } from './attribution';
import { assign, type FixedPair, type ObservationIndex } from './candidates';
import {
  evaluateConditions,
  firstMatch,
  observedScopeExceedsDeclared,
  unaskedLikely,
  unaskedLikelyAt,
} from './conditions';
import { isAssignable, planClaims, TextFacts } from './features';
import { grade, gradeOrphan } from './grade';
import { instantMs } from './normalize';
import { assertLoadedPolicy, type Policy, type RuleOutcome } from './policy';
import type { Activity, AgentId, Claim, Coverage, GradeContext, Grant, Ulid } from './schema';
import { scopeSubjects, spendIndex } from './scope';
import { compareText as compareTextShared } from './order';

export { BatchError, type BatchErrorCode } from './batch-error';
export type { BatchInputs, BatchReceipt } from './batch-grade';

/**
 * A pre-assignment (§4.3): a FINAL or USER_OVERRIDDEN claim receipt fixes its observation to its claim
 * (`claimId`); an overridden UNASKED receipt fixes its observation as taken (`claimId: null`).
 */
export interface BatchFixed {
  readonly observationId: Ulid;
  readonly claimId: Ulid | null;
}

/** The batch facts every stage reads, computed once. */
interface Batch {
  readonly policy: Policy;
  readonly coverage: Coverage;
  readonly grants: ReadonlyMap<AgentId, Grant>;
  readonly fixedPairs: readonly FixedPair[];
  readonly taken: ReadonlySet<Ulid>;
  /** Claim-less outcomes by the two conditions that apply claim-less (`claimlessOutcome`). */
  readonly claimless: Map<number, RuleOutcome | null>;
}

/** The one code-unit order (order.ts), bound once: the test transform turns an imported call into a getter. */
const compareText = compareTextShared;

/** The keys of the Claim schema (a strict object), in schema order. */
const CLAIM_KEYS: ReadonlySet<string> = new Set([
  'id',
  'agent',
  'requestId',
  'type',
  'counterparty',
  'amountCents',
  'currency',
  'subjectHint',
  'claimedAt',
  'claimedAtPrecision',
  'claimedAtEnd',
  'targetAt',
  'observedAt',
  'sourceKind',
  'extractor',
  'rawHash',
]);

/**
 * The claim with every schema key present (an absent optional one `undefined`), in schema order: every value
 * reads the same, and canonical JSON (which drops `undefined`) writes it the same, but every claim of a batch then
 * has one object shape, so the code that reads claims runs (and is compiled) for one shape instead of one per
 * combination of optional fields. A claim holding any other key is graded as given.
 */
function uniformClaim(claim: Claim): Claim {
  for (const key of Object.keys(claim)) if (!CLAIM_KEYS.has(key)) return claim;
  return {
    id: claim.id,
    agent: claim.agent,
    requestId: claim.requestId,
    type: claim.type,
    counterparty: claim.counterparty,
    amountCents: claim.amountCents,
    currency: claim.currency,
    subjectHint: claim.subjectHint,
    claimedAt: claim.claimedAt,
    claimedAtPrecision: claim.claimedAtPrecision,
    claimedAtEnd: claim.claimedAtEnd,
    targetAt: claim.targetAt,
    observedAt: claim.observedAt,
    sourceKind: claim.sourceKind,
    extractor: claim.extractor,
    rawHash: claim.rawHash,
  };
}

/**
 * §3: the claims first seen by `evaluatedMs` (`observedAt ≤ evaluatedAt`), in input order. A later claim does
 * not exist yet for this batch: replay at an earlier instant sees exactly what grading saw.
 */
function claimsSeenBy(claims: readonly Claim[], evaluatedMs: number): Claim[] {
  const seen: Claim[] = [];
  for (const claim of claims) if (instantMs(claim.observedAt) <= evaluatedMs) seen.push(claim);
  return seen;
}

/**
 * §3, §6.3, §7: the claims cumulative spend and attribution read: `activity.claims` first seen by `evaluatedMs`,
 * plus each graded claim whose id they do not list. `activity.claims` should hold every claim (§3), the graded ones
 * included; one the caller left out is still the user's claim, so it still counts toward the cumulative ceiling and
 * still suppresses adjacency, never silently skipped (Hard Rules 5, 6). Each claim is read through its uniform copy;
 * an id listed in both is kept once (the `activity.claims` copy), so nothing is counted twice and the fast spend
 * index never sees a repeated id because of the union.
 */
function historyOf(
  listed: readonly Claim[],
  graded: readonly Claim[],
  uniform: ReadonlyMap<Claim, Claim>,
  evaluatedMs: number,
): Claim[] {
  const history: Claim[] = [];
  const ids = new Set<Ulid>();
  for (const claim of claimsSeenBy(listed, evaluatedMs)) {
    history.push(uniform.get(claim) ?? uniformClaim(claim));
    ids.add(claim.id);
  }
  for (const claim of graded) if (!ids.has(claim.id)) history.push(claim);
  return history;
}

/** Fixed pairs and taken observations, after checking no graded claim is also fixed (it is FINAL). */
function splitFixed(claims: readonly Claim[], fixed: readonly BatchFixed[]) {
  const fixedPairs: FixedPair[] = [];
  const taken = new Set<Ulid>();
  for (const { observationId, claimId } of fixed) {
    if (claimId === null) taken.add(observationId);
    else fixedPairs.push({ observationId, claimId });
  }
  const fixedClaims = new Set(fixedPairs.map((pair) => pair.claimId));
  const seen = new Set<Ulid>();
  for (const claim of claims) {
    if (seen.has(claim.id)) throw new BatchError('duplicate_claim');
    if (fixedClaims.has(claim.id)) throw new BatchError('claim_fixed');
    seen.add(claim.id);
  }
  return { fixedPairs, taken };
}

/**
 * §4.1 candidates of every assignable claim (batch-retrieve.ts: exactly `candidates()` per claim, read type by
 * type over the union of the windows, one read at a time), each scored against every candidate exactly once (§5,
 * batch-score.ts). Observations fixed to a claim or taken are not scored: `assign` would never give them to another
 * claim, and `grade` never sees them as candidates.
 */
async function retrieveAndScore(
  claims: readonly Claim[],
  index: ObservationIndex,
  batch: Batch,
): Promise<Map<Claim, ScoredClaim>> {
  const { policy } = batch;
  const texts = new TextFacts(policy.normalize.stopWords);
  planClaims(claims, policy, texts);
  const assignable: Claim[] = [];
  for (const claim of claims) if (isAssignable(claim, policy)) assignable.push(claim);
  const found = await candidatesOfAll(assignable, index, policy, texts);
  const fixedObservations = new Set(batch.fixedPairs.map((pair) => pair.observationId));
  const blocked = fixedObservations.size > 0 || batch.taken.size > 0;
  const skip = blocked ? (id: Ulid): boolean => fixedObservations.has(id) || batch.taken.has(id) : null;
  const scored = new Map<Claim, ScoredClaim>();
  for (const claim of assignable) {
    const own = found.get(claim);
    if (own !== undefined) scored.set(claim, scoreClaim(claim, own, policy, skip));
  }
  return scored;
}

/** The values a condition can take: holds, does not hold, not applicable. */
const CONDITION_VALUES: readonly (boolean | null)[] = [true, false, null];

/** `claimlessOutcome`'s memo key for the values of `unaskedLikely` and `observedScopeExceedsDeclared`. */
function claimlessKey(unasked: boolean | null, scope: boolean | null): number {
  return CONDITION_VALUES.indexOf(unasked) * CONDITION_VALUES.length + CONDITION_VALUES.indexOf(scope);
}

/** A context with no scope and no attribution: `observedScopeExceedsDeclared` reads an orphan's context as this. */
const NO_SCOPE: GradeContext = { priorSpendCents: 0 };

/**
 * For `attributor`: whether an orphan whose likely agent is `agent`, at `scoreBp`, can become an UNASKED receipt,
 * read from `claimlessOutcome`'s memo without building its attribution (§7). Unknown (no orphan with those condition
 * values decided yet) counts as wanted: the attribution is built and decided as before. Reads the agent's grant in
 * force first (`grantOf` throws for an agent with none, as it did once the attribution was built).
 */
function wantedOrphans(batch: Batch) {
  return (agent: AgentId, scoreBp: number): boolean => {
    const grant = grantOf(batch.grants, agent);
    const key = claimlessKey(
      unaskedLikelyAt(scoreBp, batch.policy),
      observedScopeExceedsDeclared(grant, NO_SCOPE),
    );
    return !batch.claimless.has(key) || batch.claimless.get(key) === 'UNASKED';
  };
}

/**
 * The outcome `grade` reaches for a claim-less subject, from the same evaluators and the same first match, without
 * building a receipt. Claim-less, only `unaskedLikely` and `observedScopeExceedsDeclared` are applicable (§6.1), so
 * the first match is a function of their two values alone: it is found once per pair of values and batch. A batch
 * uses it to skip hashing receipts it would drop (§3). Null when no rule matches (terminal `default_unverifiable`).
 */
function claimlessOutcome(grant: Grant, context: GradeContext, batch: Batch): RuleOutcome | null {
  const { policy, coverage } = batch;
  const key = claimlessKey(unaskedLikely(context, policy), observedScopeExceedsDeclared(grant, context));
  if (!batch.claimless.has(key)) {
    const facts = { claim: null, grant, policy, coverage, context, bestScore: null, assigned: null };
    batch.claimless.set(key, firstMatch(policy.rules, evaluateConditions(facts))?.then ?? null);
  }
  return batch.claimless.get(key) ?? null;
}

/**
 * UNASKED receipts for the orphans (§4.3, §7): covered, visible, assigned to no claim, not taken. Each is
 * `grade(null, [orphan], …)` with the evidence the batch shares (`gradeOrphan`): the orphans were read through
 * `visibleAt`, so each was first seen by `evaluatedAt`, as `grade` would require.
 */
function unaskedReceipts(
  covered: readonly Keyed[],
  assignment: ReadonlyMap<Ulid, Ulid>,
  activity: Activity,
  batch: Batch,
  evidence: BatchEvidence,
): BatchReceipt[] {
  const { policy, coverage } = batch;
  const attribute = attributor(activity, policy, coverage.evaluatedAt);
  const wanted = wantedOrphans(batch);
  const receipts: BatchReceipt[] = [];
  for (const { observation: orphan, atMs } of covered) {
    if (assignment.has(orphan.id) || batch.taken.has(orphan.id)) continue;
    const attribution = attribute(orphan, atMs, wanted);
    if (attribution === null) continue;
    const grant = grantOf(batch.grants, attribution.agent);
    const context: GradeContext = { priorSpendCents: 0, attribution };
    if (claimlessOutcome(grant, context, batch) !== 'UNASKED') continue;
    const receipt = gradeOrphan(orphan, evidence.shared(grant), grant, policy, context);
    receipts.push({ receipt, inputs: inputsOf(grant, context, policy) });
  }
  return receipts;
}

/** OVER_SCOPE receipts for observed scopes the user never declared (§6.1 `observedScopeExceedsDeclared`). */
function scopeReceipts(batch: Batch): BatchReceipt[] {
  const { policy, coverage } = batch;
  const receipts: BatchReceipt[] = [];
  for (const grant of batch.grants.values()) {
    for (const observed of scopeSubjects(grant)) {
      const context: GradeContext = { priorSpendCents: 0, scope: { observed } };
      if (claimlessOutcome(grant, context, batch) !== 'OVER_SCOPE') continue;
      const receipt = grade(null, [], grant, policy, coverage, context);
      receipts.push({ receipt, inputs: inputsOf(grant, context, policy) });
    }
  }
  return receipts;
}

/** The inputs a claim-less receipt was graded with besides the batch's coverage (§3). */
function inputsOf(grant: Grant, context: GradeContext, policy: Policy): BatchInputs {
  return { grant, context, policyHash: policy.policyHash };
}

function compareIds(a: BatchReceipt, b: BatchReceipt): number {
  return compareText(a.receipt.id, b.receipt.id);
}

/** Ordered by receipt id; two receipts with one id are a corrupt batch (`duplicate_receipt`). */
function byReceiptId(graded: readonly BatchReceipt[]): BatchReceipt[] {
  const sorted = [...graded].sort(compareIds);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i - 1]?.receipt.id === sorted[i]?.receipt.id) throw new BatchError('duplicate_receipt');
  }
  return sorted;
}

/**
 * Grades a batch (§3): `claims` are the PENDING claims to grade; `fixed` the FINAL and USER_OVERRIDDEN
 * pre-assignments. Returns claim, UNASKED and `over_scope_observed` receipts ordered by receipt id, each with
 * the grant, context and policy hash it was graded with (the coverage is `coverage`). A claim first seen after
 * `evaluatedAt` is ignored (§3): no receipt, no evidence, no spend.
 *
 * Throws `PolicyError('policy_not_loaded')` for a policy `loadPolicy` did not return, before reading anything;
 * `BatchError` for a claim given twice (seen or not) or also fixed, an agent with no grant in force (or two at one
 * instant), or two receipts with one id; `CandidatesError('fixed_conflict')` for fixed pairs that are not
 * one-to-one; and whatever `grade` and the index throw. Nothing is graded approximately (Hard Rule 6). A graded
 * claim that `activity.claims` omits still counts in the spend history and still suppresses adjacency (§3, §6.3,
 * §7: `historyOf`).
 */
export async function gradeBatch(
  claims: readonly Claim[],
  index: ObservationIndex,
  grants: readonly Grant[],
  policy: Policy,
  coverage: Coverage,
  activity: Activity,
  fixed: readonly BatchFixed[] = [],
): Promise<BatchReceipt[]> {
  assertLoadedPolicy(policy);
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const { fixedPairs, taken } = splitFixed(claims, fixed);
  const uniform = new Map<Claim, Claim>();
  const graded: Claim[] = [];
  for (const claim of claimsSeenBy(claims, evaluatedMs)) {
    const copy = uniformClaim(claim);
    uniform.set(claim, copy);
    graded.push(copy);
  }
  const read: Activity = { ...activity, claims: historyOf(activity.claims, graded, uniform, evaluatedMs) };
  const inForce = grantsInForce(grants, evaluatedMs);
  const batch: Batch = { policy, coverage, grants: inForce, fixedPairs, taken, claimless: new Map() };
  const visible = visibleAt(index, evaluatedMs);
  const scored = await retrieveAndScore(graded, visible, batch);
  const pairs = assignablePairs([...scored.values()], policy.bp.thresholds.partial);
  const assignment = assign(pairs, policy, fixedPairs, taken);
  const covered = await coveredObservations(visible, coverage, policy);
  const priorSpend = spendIndex(read.claims, policy);
  const receiptBatch = { policy, coverage, grants: inForce, assignment, taken, priorSpend };
  const evidence = new BatchEvidence(receiptBatch);
  return byReceiptId([
    ...claimReceipts(graded, scored, receiptBatch, evidence),
    ...unaskedReceipts(covered, assignment, read, batch, evidence),
    ...scopeReceipts(batch),
  ]);
}
