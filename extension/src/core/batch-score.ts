/**
 * Scoring a batch's pairs (docs/grading.md §4.3, §5, §5.3; the task 1.5 grading perf gate). Internal to gradeBatch.
 *
 * Every (assignable claim, candidate) pair is scored exactly once (`features.ts` `RowScorer`), and its exact score
 * kept beside the claim's rows: as a fraction of two safe integers when the sum stays below 2^53 (ratio.ts
 * `weightedFraction`; unreduced, since only comparisons read it), else as its BigInt Ratio. Assignment reads the
 * pairs at or above `thresholds.partial`; `grade`'s best candidate reads them again (batch-grade.ts). Every
 * comparison is exact: in Number by `compareFractions` (nothing rounds), else in BigInt (§5.3).
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import type { ClaimCandidates } from './batch-retrieve';
import type { ScoredPair } from './candidates';
import { type FeaturePolicy, RowScorer } from './features';
import { instantMs } from './normalize';
import {
  compareFractions,
  compareRatio,
  fractionGteBasisPoints,
  ratio,
  type Ratio,
  ratioGteBasisPoints,
} from './ratio';
import type { Claim, Ulid } from './schema';

/**
 * Imported functions called once per pair or row, bound here once: the test runner's module transform turns every
 * read of an imported binding into a getter call (normalize-time.ts binds its units for the same reason).
 */
const compareFractionsLocal = compareFractions;
const fractionGteBasisPointsLocal = fractionGteBasisPoints;
const ratioLocal = ratio;
const compareRatioLocal = compareRatio;
const ratioGteBasisPointsLocal = ratioGteBasisPoints;

/** One assignable claim of a batch: its candidates, its scorer, and each pair's exact score (by row position). */
export interface ScoredClaim {
  readonly claim: Claim;
  readonly found: ClaimCandidates;
  readonly scorer: RowScorer;
  /** `claimedAt` as epoch ms (§4.3's tie-break). */
  readonly claimedAtMs: number;
  /**
   * The score of the pair at position k of `found.rows` as an unreduced fraction `num[k] / den[k]` of safe integers
   * (exact; compared only by `compareFractions`): `den[k]` is 0 for a row never scored (fixed or taken: no claim of
   * the batch can have it), NaN when the score needs BigInt (then `big` holds its Ratio).
   */
  readonly num: Float64Array;
  readonly den: Float64Array;
  readonly big: ReadonlyMap<number, Ratio>;
}

/**
 * Scores every pair of one assignable claim, leaving out rows `skip` names (fixed to a claim or taken: §4.3 never
 * gives them to another claim, and `grade` never sees them); null when there are none.
 */
export function scoreClaim(
  claim: Claim,
  found: ClaimCandidates,
  policy: FeaturePolicy,
  skip: ((id: Ulid) => boolean) | null,
): ScoredClaim {
  const claimedAtMs = instantMs(claim.claimedAt);
  const scorer = new RowScorer(claim, policy);
  const { table, rows } = found;
  // Sized once and zero-filled: a row left out keeps num 0 and den 0 ("never scored").
  const num = new Float64Array(rows.length);
  const den = new Float64Array(rows.length);
  const big = new Map<number, Ratio>();
  const fraction = new Float64Array([0, 1]);
  for (let k = 0; k < rows.length; k += 1) {
    const row = rows[k] ?? 0;
    if (skip?.(table.id(row)) === true) continue;
    const facts = table.facts(row);
    if (scorer.fraction(facts, fraction)) {
      num[k] = fraction[0] ?? 0;
      den[k] = fraction[1] ?? 1;
    } else {
      den[k] = Number.NaN;
      big.set(k, scorer.score(facts).ratio);
    }
  }
  return { claim, found, scorer, claimedAtMs, num, den, big };
}

/** The exact score at position `k` as a (reduced) Ratio, the one `Score.ratio` gives. */
export function ratioAt(scored: ScoredClaim, k: number): Ratio {
  const big = scored.big.get(k);
  if (big !== undefined) return big;
  return ratioLocal(scored.num[k] ?? 0, scored.den[k] ?? 1);
}

/** −1, 0 or 1 as the score at position `a` is below, equal to or above the one at `b` (exact, §5.3). */
export function compareAt(scored: ScoredClaim, a: number, b: number): -1 | 0 | 1 {
  const { num, den } = scored;
  const denA = den[a] ?? 0;
  const denB = den[b] ?? 0;
  if (Number.isNaN(denA) || Number.isNaN(denB))
    return compareRatioLocal(ratioAt(scored, a), ratioAt(scored, b));
  return compareFractionsLocal(num[a] ?? 0, denA, num[b] ?? 0, denB);
}

/** Whether the score at position `k` is at least `bp` basis points (exact, §5.3). */
function atLeast(scored: ScoredClaim, k: number, bp: number): boolean {
  const den = scored.den[k] ?? 0;
  if (Number.isNaN(den)) return ratioGteBasisPointsLocal(ratioAt(scored, k), bp);
  return fractionGteBasisPointsLocal(scored.num[k] ?? 0, den, bp);
}

/**
 * The scored pairs at or above `thresholds.partial` (in basis points), for §4.3 `assign`: a pair below it never
 * consumes anything, so leaving it out cannot change the assignment.
 */
export function assignablePairs(scored: readonly ScoredClaim[], partialBp: number): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  for (const one of scored) {
    const { claim, found, claimedAtMs, den } = one;
    for (let k = 0; k < den.length; k += 1) {
      if (den[k] === 0 || !atLeast(one, k, partialBp)) continue;
      const observationId = found.table.id(found.rows[k] ?? 0);
      pairs.push({ claimId: claim.id, claimedAtMs, observationId, score: ratioAt(one, k) });
    }
  }
  return pairs;
}
