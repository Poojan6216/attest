/**
 * The model's one way into a grade (docs/grading.md §5.4, v1.19; Sprint 5.0; Hard Rule 4: the model only proposes
 * scores). A claim's context may carry the advisory matcher's score of each of its candidates
 * (`GradeContext.modelScores`, in basis points; src/intel proposes them), and the policy weighs that score
 * (`features.modelScore`, λ, capped by the loader: policy-checks.ts `modelIssues`). The deterministic floor decides
 * first: the best candidate is chosen and assigned on its floor score alone (§4.3, §5.3). Only then may that
 * candidate's score rise, to
 *
 *   max(S, (1 − λ)·S + λ·m)      S: its floor score, m: the model's score of it,
 *
 * and only when S is already at or above `thresholds.partial`. So the model can move a PARTIAL toward VERIFIED, but
 * never lowers a score, never lifts one below `partial` (NOT_FOUND, UNVERIFIABLE and PENDING stay as the floor
 * decides), and never changes which observation a claim takes. tests/property/monotonicity.spec.ts holds this.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import type { BestCandidate } from './grade-best';
import type { Policy } from './policy';
import { compareRatio, ratio, ratioGteBasisPoints, toDisplay } from './ratio';
import type { GradeContext } from './schema';
import { BASIS_POINTS } from './units';

const B = BigInt(BASIS_POINTS);

/**
 * The best candidate as the model's score allows it (header): its score raised when the floor is at `partial` or above
 * and the raise is higher, else as it was. The model's score is shown with the candidate's signals (`modelScore`)
 * whenever the context holds one for it, raised or not.
 */
export function raisedBest(
  best: BestCandidate | null,
  context: GradeContext,
  policy: Policy,
): BestCandidate | null {
  if (best === null) return null;
  const model = context.modelScores?.find(({ observationId }) => observationId === best.observation.id);
  if (model === undefined) return best;
  const signals = { ...best.signals, modelScore: toDisplay(ratio(model.score, BASIS_POINTS)) };
  const weight = BigInt(policy.bp.features.modelScore);
  if (!ratioGteBasisPoints(best.score, policy.bp.thresholds.partial)) return { ...best, signals };
  const { num, den } = best.score;
  const raised = ratio((B - weight) * num * B + weight * BigInt(model.score) * den, B * B * den);
  if (compareRatio(raised, best.score) <= 0) return { ...best, signals };
  return { ...best, score: raised, signals: { ...signals, score: toDisplay(raised) } };
}
