/**
 * Batch grading (docs/grading.md §3, §4.3, §6.3, §7; module contract §13 `batch.ts`). `gradeBatch` is the only
 * path from the background to receipts: it grades exactly the PENDING `claims` it is given, with FINAL and
 * USER_OVERRIDDEN claims as fixed pre-assignments, and returns
 *
 *  - one receipt per claim: candidates are retrieved and scored for every assignable claim (§4.3: never for an
 *    underspecified claim, a calendar claim without `targetAt`, or a type with no sources), observations are
 *    assigned one-to-one (fixed pairs first, then best score first), and `grade` sees the claim's candidates
 *    minus those assigned to other claims or fixed as taken, with `priorSpendCents` read from
 *    `activity.claims` (§6.3, which holds FINAL and USER_OVERRIDDEN claims too);
 *  - one UNASKED receipt per orphan that `grade` calls UNASKED: an observation of a covered type in a window
 *    its own source's observer saw, assigned to no claim and not taken, attributed with `attributor` (§7);
 *  - one OVER_SCOPE receipt per observed scope of a grant in force that `grade` calls OVER_SCOPE (rule
 *    `over_scope_observed`). A claim-less grade with any other outcome yields no receipt (§3).
 *
 * Inputs from after `coverage.evaluatedAt` are ignored (§3): observations first seen later (`visibleAt`),
 * coverage synced later (`seenWindows`; `grade` applies the same rule to eligibility) and grants written later
 * (`grantsInForce`). The output is ordered by receipt id, so it never depends on input order or index return
 * order. It stores nothing: the caller replaces each subject's row (§3).
 *
 * PURE: no I/O but the injected index, no clock, no logging (Hard Rule 4). Async only because the index is.
 */
import { BatchError } from './batch-error';
import { grantOf, grantsInForce } from './batch-grants';
import { coveredObservations, visibleAt } from './batch-orphans';
import { candidatesOfAll } from './batch-retrieve';
import { attributor } from './attribution';
import {
  assign,
  exclusiveCandidates,
  type FixedPair,
  type ObservationIndex,
  type ScoredPair,
} from './candidates';
import { evaluateConditions, firstMatch } from './conditions';
import { isAssignable, pairScorer } from './features';
import { grade } from './grade';
import { instantMs } from './normalize';
import type { Policy, RuleOutcome } from './policy';
import { scoreGteBasisPoints } from './ratio';
import type {
  Activity,
  AgentId,
  Claim,
  Coverage,
  GradeContext,
  Grant,
  Observation,
  Receipt,
  Ulid,
} from './schema';
import { priorSpendCents, scopeSubjects } from './scope';

export { BatchError, type BatchErrorCode } from './batch-error';

/**
 * A pre-assignment (§4.3): a FINAL or USER_OVERRIDDEN claim receipt fixes its observation to its claim
 * (`claimId`); an overridden UNASKED receipt fixes its observation as taken (`claimId: null`).
 */
export interface BatchFixed {
  readonly observationId: Ulid;
  readonly claimId: Ulid | null;
}

/** One graded claim's retrieval: its candidates (empty when it is not assignable). */
interface Retrieved {
  readonly claim: Claim;
  readonly assignable: boolean;
  readonly candidates: readonly Observation[];
}

/** The batch facts every stage reads, computed once. */
interface Batch {
  readonly policy: Policy;
  readonly coverage: Coverage;
  readonly grants: ReadonlyMap<AgentId, Grant>;
  readonly fixedPairs: readonly FixedPair[];
  readonly taken: ReadonlySet<Ulid>;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
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
 * type over the union of the windows; one read at a time).
 */
async function retrieve(
  claims: readonly Claim[],
  index: ObservationIndex,
  policy: Policy,
): Promise<Retrieved[]> {
  const assignable = claims.filter((claim) => isAssignable(claim, policy));
  const found = await candidatesOfAll(assignable, index, policy);
  return claims.map((claim) => {
    const own = found.get(claim);
    return { claim, assignable: own !== undefined, candidates: own ?? [] };
  });
}

/**
 * Every (assignable claim, candidate) pair scored exactly (§5), each once (`pairScorer` remembers the score for
 * `grade`'s best candidate). Observations fixed to a claim or as taken are left out: `assign` would never give
 * them to another claim, and `grade` never sees them as candidates. So are pairs below `thresholds.partial`
 * (exact, §5.3): `assign` drops them before anything else and they never consume anything (§4.3), so leaving them
 * out cannot change the assignment.
 */
function scorePairs(retrieved: readonly Retrieved[], batch: Batch): ScoredPair[] {
  const fixedObservations = new Set(batch.fixedPairs.map((pair) => pair.observationId));
  const partialBp = batch.policy.bp.thresholds.partial;
  const pairs: ScoredPair[] = [];
  for (const { claim, assignable, candidates: found } of retrieved) {
    if (!assignable) continue;
    const claimedAtMs = instantMs(claim.claimedAt);
    const scoreOf = pairScorer(claim, batch.policy);
    for (const observation of found) {
      if (fixedObservations.has(observation.id) || batch.taken.has(observation.id)) continue;
      const score = scoreOf(observation);
      if (!scoreGteBasisPoints(score, partialBp)) continue;
      pairs.push({ claimId: claim.id, claimedAtMs, observationId: observation.id, score: score.ratio });
    }
  }
  return pairs;
}

/** Each agent's claims from `activity.claims`: `priorSpendCents` reads only the claim's own agent (§6.3). */
function claimsByAgent(claims: readonly Claim[]): ReadonlyMap<AgentId, readonly Claim[]> {
  const byAgent = new Map<AgentId, Claim[]>();
  for (const claim of claims) {
    const held = byAgent.get(claim.agent);
    if (held === undefined) byAgent.set(claim.agent, [claim]);
    else held.push(claim);
  }
  return byAgent;
}

/** One receipt per claim (§3, §4.3, §6.3). */
function claimReceipts(
  retrieved: readonly Retrieved[],
  assignment: ReadonlyMap<Ulid, Ulid>,
  activity: Activity,
  batch: Batch,
): Receipt[] {
  const history = claimsByAgent(activity.claims);
  return retrieved.map(({ claim, candidates: found }) => {
    const own = exclusiveCandidates(claim.id, found, assignment, batch.taken);
    const priorSpend = priorSpendCents(claim, history.get(claim.agent) ?? [], batch.policy);
    const grant = grantOf(batch.grants, claim.agent);
    return grade(claim, own, grant, batch.policy, batch.coverage, { priorSpendCents: priorSpend });
  });
}

/**
 * The outcome `grade` reaches for a claim-less subject, from the same evaluators and the same first match, without
 * building a receipt. Claim-less, only `unaskedLikely` and `observedScopeExceedsDeclared` are applicable (§6.1),
 * so this reads the context and the grant alone; a batch uses it to skip hashing receipts it would drop (§3).
 * Null when no rule matches (terminal `default_unverifiable`).
 */
function claimlessOutcome(grant: Grant, context: GradeContext, batch: Batch): RuleOutcome | null {
  const { policy, coverage } = batch;
  const facts = { claim: null, grant, policy, coverage, context, bestScore: null, assigned: null };
  return firstMatch(policy.rules, evaluateConditions(facts))?.then ?? null;
}

/** UNASKED receipts for the orphans (§4.3, §7): covered, visible, assigned to no claim, not taken. */
function unaskedReceipts(
  covered: readonly Observation[],
  assignment: ReadonlyMap<Ulid, Ulid>,
  activity: Activity,
  batch: Batch,
): Receipt[] {
  const attribute = attributor(activity, batch.policy, batch.coverage.evaluatedAt);
  const receipts: Receipt[] = [];
  for (const orphan of covered) {
    if (assignment.has(orphan.id) || batch.taken.has(orphan.id)) continue;
    const attribution = attribute(orphan);
    if (attribution === null) continue;
    const grant = grantOf(batch.grants, attribution.agent);
    const context = { priorSpendCents: 0, attribution };
    if (claimlessOutcome(grant, context, batch) !== 'UNASKED') continue;
    receipts.push(grade(null, [orphan], grant, batch.policy, batch.coverage, context));
  }
  return receipts;
}

/** OVER_SCOPE receipts for observed scopes the user never declared (§6.1 `observedScopeExceedsDeclared`). */
function scopeReceipts(batch: Batch): Receipt[] {
  const receipts: Receipt[] = [];
  for (const grant of batch.grants.values()) {
    for (const observed of scopeSubjects(grant)) {
      const context = { priorSpendCents: 0, scope: { observed } };
      if (claimlessOutcome(grant, context, batch) !== 'OVER_SCOPE') continue;
      receipts.push(grade(null, [], grant, batch.policy, batch.coverage, context));
    }
  }
  return receipts;
}

/** Ordered by receipt id; two receipts with one id are a corrupt batch (`duplicate_receipt`). */
function byReceiptId(receipts: readonly Receipt[]): Receipt[] {
  const sorted = [...receipts].sort((a, b) => compareText(a.id, b.id));
  sorted.forEach((receipt, i) => {
    if (i > 0 && sorted[i - 1]?.id === receipt.id) throw new BatchError('duplicate_receipt');
  });
  return sorted;
}

/**
 * Grades a batch (§3): `claims` are the PENDING claims to grade; `fixed` the FINAL and USER_OVERRIDDEN
 * pre-assignments. Returns claim, UNASKED and `over_scope_observed` receipts ordered by receipt id.
 *
 * Throws `BatchError` for a claim given twice or also fixed, an agent with no grant in force (or two at one
 * instant), or two receipts with one id; `CandidatesError('fixed_conflict')` for fixed pairs that are not
 * one-to-one; and whatever `grade` and the index throw. Nothing is graded approximately (Hard Rule 6).
 */
export async function gradeBatch(
  claims: readonly Claim[],
  index: ObservationIndex,
  grants: readonly Grant[],
  policy: Policy,
  coverage: Coverage,
  activity: Activity,
  fixed: readonly BatchFixed[] = [],
): Promise<Receipt[]> {
  const evaluatedMs = instantMs(coverage.evaluatedAt);
  const { fixedPairs, taken } = splitFixed(claims, fixed);
  const batch: Batch = { policy, coverage, grants: grantsInForce(grants, evaluatedMs), fixedPairs, taken };
  const visible = visibleAt(index, evaluatedMs);
  const retrieved = await retrieve(claims, visible, policy);
  const assignment = assign(scorePairs(retrieved, batch), policy, fixedPairs, taken);
  const covered = await coveredObservations(visible, coverage, policy);
  return byReceiptId([
    ...claimReceipts(retrieved, assignment, activity, batch),
    ...unaskedReceipts(covered, assignment, activity, batch),
    ...scopeReceipts(batch),
  ]);
}
