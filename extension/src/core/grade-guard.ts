/**
 * What `grade()` checks of a claim's candidates before it reads them (docs/grading.md §3, §4.1; Hard Rules 5, 6).
 * Internal to grade.ts.
 *
 * `grade` trusts its caller for the assignment (§4.3), but never for what a candidate IS: every candidate of a
 * claim must be one `candidates()` could have returned for it, by the same predicates (`claimWindow` and
 * `inClaimWindow` in window.ts, `fromRelevantSource`, `firstSeenFromMs` and `passesFirstSeen` in order.ts). Anything
 * else is a caller's bug, refused with `GradeError('foreign_candidate')` rather than graded: a FINAL receipt is never
 * regraded, so one wrong list would leave a permanent false VERIFIED (or PARTIAL, or an OVER_SCOPE from a stranger's
 * amount).
 *
 * Checked: the type is the claim's; the source is one the policy lists for that type (§6.1 relevant sources:
 * evidence the claim's coverage never reads cannot verify it); `occurredAt` lies in the claim window (a calendar
 * claim without `targetAt` has none, so any candidate is foreign); for `calendar.created`, the row's own
 * `observedAt` is at or after the first-seen bound (its first sighting can only be earlier, so a row that fails this
 * was never a candidate). Not refused: a candidate first seen after `evaluatedAt`, which §3 has `grade` ignore, so
 * replay at an earlier instant sees what grading saw.
 *
 * Throwing rather than filtering keeps `inputsHash` and `candidatesHash` meaning exactly the candidates given.
 * `gradeBatch` hands `gradeClaim` evidence retrieved by the same predicates (batch-retrieve.ts), and replay grades
 * with `candidates()` itself, so neither meets the refusal (grade-guard.spec.ts, grade-guard.property.spec.ts).
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4). Each instant is read through the per-object memos of
 * candidates-time.ts, and the window once per call (its precision unit is memoised per claim, window.ts).
 */
import { observedMs, occurredMs } from './candidates-time';
import { GradeError } from './grade-error';
import { firstSeenFromMs, fromRelevantSource, passesFirstSeen } from './order';
import type { Policy } from './policy';
import type { Claim, Observation } from './schema';
import { claimWindow, inClaimWindow } from './window';

/** The policy fields the check reads. A loaded `Policy` satisfies it. */
export type GuardPolicy = Pick<Policy, 'windows' | 'sourcesByType'>;

/**
 * Throws `GradeError('foreign_candidate')` unless every one of `candidates` is a §4.1 candidate of `claim` (see the
 * file comment). Throws what `claimWindow` throws for a claim whose window cannot be read.
 */
export function checkCandidates(claim: Claim, candidates: readonly Observation[], policy: GuardPolicy): void {
  if (candidates.length === 0) return;
  const window = claimWindow(claim, policy);
  if (window === null) throw new GradeError('foreign_candidate');
  const firstSeenFrom = firstSeenFromMs(claim, policy);
  for (const candidate of candidates) {
    const foreign =
      candidate.type !== claim.type ||
      !fromRelevantSource(candidate, claim.type, policy) ||
      !inClaimWindow(window, occurredMs(candidate)) ||
      !passesFirstSeen(observedMs(candidate), firstSeenFrom);
    if (foreign) throw new GradeError('foreign_candidate');
  }
}
