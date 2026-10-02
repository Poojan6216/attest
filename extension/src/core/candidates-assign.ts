/**
 * One observation verifies at most one claim (docs/grading.md §4.3). Pure and deterministic: the result
 * depends on the set of pairs, never on their order, and every score comparison is exact (ratio.ts, §5.3).
 *
 * Fixed pairs (FINAL and USER_OVERRIDDEN claims) are taken first and never moved. Then the greedy pass:
 * pairs with score ≥ `thresholds.partial`, best score first, ties by earlier `claimedAt` instant (epoch ms,
 * never strings), then claim id, then observation id; a pair is taken iff neither its claim nor its
 * observation is already taken. One-to-one both ways. A pair below partial never consumes anything.
 */
import { CandidatesError } from './candidates-error';
import type { Policy } from './policy';
import { compareRatio, type Ratio, ratioGteBasisPoints } from './ratio';
import type { Ulid } from './schema';

/** An (eligible claim, candidate) pair and its exact score (features.ts). */
export interface ScoredPair {
  readonly claimId: Ulid;
  /** The claim's `claimedAt` instant, epoch ms. */
  readonly claimedAtMs: number;
  readonly observationId: Ulid;
  readonly score: Ratio;
}

/** A pre-assignment from a FINAL or USER_OVERRIDDEN claim receipt. */
export interface FixedPair {
  readonly observationId: Ulid;
  readonly claimId: Ulid;
}

/** The policy fields assignment reads. A loaded `Policy` satisfies it. */
export type AssignPolicy = Pick<Policy, 'bp'>;

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareNumbers(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Best score first, then earlier claimedAt, then claim id, then observation id: a total order on pairs. */
function comparePairs(a: ScoredPair, b: ScoredPair): number {
  return (
    compareRatio(b.score, a.score) ||
    compareNumbers(a.claimedAtMs, b.claimedAtMs) ||
    compareText(a.claimId, b.claimId) ||
    compareText(a.observationId, b.observationId)
  );
}

/** Fixed pairs as a map, after checking they are one-to-one (a repeated identical pair is harmless). */
function fixedAssignment(fixed: readonly FixedPair[]): Map<Ulid, Ulid> {
  const byObservation = new Map<Ulid, Ulid>();
  const byClaim = new Map<Ulid, Ulid>();
  for (const { observationId, claimId } of fixed) {
    const owner = byObservation.get(observationId);
    const held = byClaim.get(claimId);
    if ((owner !== undefined && owner !== claimId) || (held !== undefined && held !== observationId)) {
      throw new CandidatesError('fixed_conflict');
    }
    byObservation.set(observationId, claimId);
    byClaim.set(claimId, observationId);
  }
  return byObservation;
}

function sortedByObservation(assignment: ReadonlyMap<Ulid, Ulid>): Map<Ulid, Ulid> {
  return new Map([...assignment].sort(([a], [b]) => compareText(a, b)));
}

/**
 * §4.3 assignment: observation id → claim id, fixed pairs included, entries ordered by observation id.
 * `taken` lists observations fixed as taken by an overridden UNASKED receipt: the greedy pass never assigns
 * them (a fixed pair is still kept as given). Throws `CandidatesError('fixed_conflict')` for fixed pairs that
 * are not one-to-one, and `CandidatesError('invalid_pair')` for a `claimedAtMs` that is not a safe integer.
 */
export function assign(
  pairs: readonly ScoredPair[],
  policy: AssignPolicy,
  fixed: readonly FixedPair[],
  taken: ReadonlySet<Ulid> = new Set<Ulid>(),
): Map<Ulid, Ulid> {
  const assignment = fixedAssignment(fixed);
  const claimsTaken = new Set<Ulid>(assignment.values());
  const partialBp = policy.bp.thresholds.partial;
  const eligible = pairs.filter((pair) => {
    if (!Number.isSafeInteger(pair.claimedAtMs)) throw new CandidatesError('invalid_pair');
    return ratioGteBasisPoints(pair.score, partialBp);
  });
  for (const pair of eligible.sort(comparePairs)) {
    if (assignment.has(pair.observationId) || taken.has(pair.observationId)) continue;
    if (claimsTaken.has(pair.claimId)) continue;
    assignment.set(pair.observationId, pair.claimId);
    claimsTaken.add(pair.claimId);
  }
  return sortedByObservation(assignment);
}

/**
 * §4.3: a claim's candidates for `grade` are its own candidates minus observations assigned to other claims
 * or fixed as taken. Order is kept.
 */
export function exclusiveCandidates<Candidate extends { readonly id: Ulid }>(
  claimId: Ulid,
  candidates: readonly Candidate[],
  assignment: ReadonlyMap<Ulid, Ulid>,
  taken: ReadonlySet<Ulid>,
): Candidate[] {
  return candidates.filter((candidate) => {
    if (taken.has(candidate.id)) return false;
    const owner = assignment.get(candidate.id);
    return owner === undefined || owner === claimId;
  });
}
