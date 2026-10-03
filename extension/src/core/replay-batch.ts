/**
 * One batch rebuilt as it was at an instant (docs/grading.md §4.3, §9). Internal to replay.ts.
 *
 * Replay cannot rerun `gradeBatch` itself: the grants, contexts and coverage of the claims it does not replay at
 * this instant are not stored, and attribution's activity is not kept. It does not need them either: which claim
 * an observation went to depends only on the batch's claims, the observations first seen by then
 * (`observedAt ≤ computedAt`), the policy and the fixed pre-assignments (§4.3). So the assignment is rebuilt from
 * the §13 building blocks, exactly as §4.3 defines it: the §4.1 candidates of every assignable batch claim
 * (`candidates`), every pair scored (`features`), the pairs at or above `thresholds.partial` assigned one-to-one
 * around the fixed pairs and taken observations (`assign`). A claim's candidates for `grade` are then its own minus
 * those assigned to other claims or taken (`exclusiveCandidates`). This is the definition the batch's fast path is
 * held to, so a disagreement between the two shows up as a replay mismatch. Whether an UNASKED receipt's
 * observation could be an orphan at all is batch-orphans.ts `isOrphanCandidate`, the predicate the batch decides
 * with (replay.ts calls it).
 *
 * PURE: no I/O but the injected index, no clock, no logging (Hard Rule 4). Async only because the index is.
 */
import {
  assign,
  candidates,
  exclusiveCandidates,
  type ObservationIndex,
  type ScoredPair,
} from './candidates';
import { features, isAssignable } from './features';
import { instantMs } from './normalize';
import type { Policy } from './policy';
import { ratioGteBasisPoints } from './ratio';
import type { FixedAt } from './batch-fixed';
import type { Claim, Observation, Ulid } from './schema';

/** A batch as it was at one instant, for one policy. */
export class ReplayBatch {
  constructor(
    /** Observation id → claim id, fixed pairs included (`assign`). */
    readonly assignment: ReadonlyMap<Ulid, Ulid>,
    readonly taken: ReadonlySet<Ulid>,
    /** The §4.1 candidates of each assignable batch claim (no entry: not assignable, so no candidates). */
    readonly candidatesOf: ReadonlyMap<Ulid, readonly Observation[]>,
  ) {}

  /**
   * The candidates `grade` saw for batch claim `claimId` (§4.3): its §4.1 candidates minus those assigned to other
   * claims or taken; none for a claim that is not assignable. Every receipt replayed at an instant is a batch claim
   * of that instant (replay-timeline.ts: its claim was first seen by then and last graded no earlier).
   */
  candidatesFor(claimId: Ulid): Observation[] {
    return exclusiveCandidates(claimId, this.candidatesOf.get(claimId) ?? [], this.assignment, this.taken);
  }
}

/**
 * Rebuilds the batch of `claims` (§4.3) over `index` (already cut to the batch's instant) under `policy`, with
 * the pre-assignments in force. Throws what `assign` throws (`CandidatesError('fixed_conflict')` for fixed pairs
 * that are not one-to-one) and what the index and `candidates` throw.
 */
export async function rebuildBatch(
  claims: readonly Claim[],
  index: ObservationIndex,
  policy: Policy,
  { fixed, taken }: FixedAt,
): Promise<ReplayBatch> {
  const blocked = new Set<Ulid>(taken);
  for (const pair of fixed) blocked.add(pair.observationId);
  const partialBp = policy.bp.thresholds.partial;
  const pairs: ScoredPair[] = [];
  const candidatesOf = new Map<Ulid, readonly Observation[]>();
  for (const claim of claims) {
    if (!isAssignable(claim, policy)) continue;
    const found = await candidates(claim, index, policy);
    candidatesOf.set(claim.id, found);
    const claimedAtMs = instantMs(claim.claimedAt);
    for (const observation of found) {
      if (blocked.has(observation.id)) continue;
      const { score } = features(claim, observation, policy);
      if (!ratioGteBasisPoints(score, partialBp)) continue;
      pairs.push({ claimId: claim.id, claimedAtMs, observationId: observation.id, score });
    }
  }
  const assignment = assign(pairs, policy, fixed, taken);
  return new ReplayBatch(assignment, taken, candidatesOf);
}
