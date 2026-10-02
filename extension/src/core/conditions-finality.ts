/**
 * When a graded receipt is FINAL (docs/grading.md §7, §8). Internal to conditions.ts: import from there.
 * `grade()` decides finality here; state.ts only applies user and lifecycle events.
 *
 * | Outcome                                             | FINAL when                                             |
 * |-----------------------------------------------------|--------------------------------------------------------|
 * | VERIFIED                                            | every relevant source synced at `end(p,t) + graceMin`  |
 * | PARTIAL, NOT_FOUND                                  | `graceElapsed`                                         |
 * | OVER_SCOPE from claim-only facts                    | immediately                                            |
 * | OVER_SCOPE that depended on the assigned candidate  | `graceElapsed` (a better match can still correct it)   |
 * | UNVERIFIABLE by a rule naming `targetMissing` or     | immediately (claim-intrinsic)                          |
 * |   `underspecified`, or for a type with no sources   |                                                        |
 * | any other UNVERIFIABLE (`no_coverage`, `partial_coverage`, `default_unverifiable`) and PENDING | `evaluatedAt ≥ end(p,t) + finalizeUnverifiableHours` |
 * | UNASKED (claim-less)                                | the agent's adapter synced at `anchor + beforeClaimMin + graceMin`, or `evaluatedAt ≥ anchor + finalizeUnverifiableHours`; anchor per §7 |
 * | any other claim-less outcome                        | immediately                                            |
 *
 * `finalAt` is `coverage.evaluatedAt`: the evaluatedAt of the grading that met the condition (§3). The clock is
 * always an input (observer syncs, `evaluatedAt`), never a wall clock (Hard Rule 4).
 */
import {
  type CoveragePolicy,
  type EligibleCoverage,
  eligibleCoverage,
  everySourceSynced,
  graceSyncMs,
  verifiedSyncMs,
} from './conditions-coverage';
import { GradeError } from './grade-error';
import { instantMs } from './normalize';
import type { PolicyRule, RuleOutcome } from './policy';
import type { Claim, Coverage, GradeContext, Grant, IsoTs, Observation } from './schema';
import { MS_PER_HOUR, MS_PER_MINUTE } from './units';
import { precisionBounds, isCalendarType } from './window';

export interface FinalityInput {
  readonly outcome: RuleOutcome;
  /** The matched rule, or null for the terminal rule `default_unverifiable`. */
  readonly rule: PolicyRule | null;
  readonly claim: Claim | null;
  /** The orphan observation of a claim-less UNASKED grade (§7); null otherwise. */
  readonly orphan: Observation | null;
  readonly grant: Grant;
  readonly coverage: Coverage;
  readonly context: GradeContext;
  readonly policy: CoveragePolicy;
  /**
   * True iff the outcome would not be OVER_SCOPE without the assigned candidate's amount, currency or address (§8,
   * OVER_SCOPE rows; grade.ts decides it: the matched rule rested on the candidate, and no claim-only rule holds).
   */
  readonly candidateDependent: boolean;
  /** The claim's eligible coverage when the caller already has it (computed from the inputs above otherwise). */
  readonly eligible?: EligibleCoverage;
}

export interface Finality {
  readonly final: boolean;
  /** `coverage.evaluatedAt`, present iff `final`. */
  readonly finalAt?: IsoTs;
}

function syncedAt(input: FinalityInput, claim: Claim, syncMs: number): boolean {
  const eligible = input.eligible ?? eligibleCoverage(claim, input.grant, input.coverage, input.policy);
  return everySourceSynced(eligible, syncMs);
}

/** `evaluatedAt ≥ end(p,t) + finalizeUnverifiableHours`: nothing stays "checking" forever (§8). */
function finalByTime(input: FinalityInput, claim: Claim): boolean {
  const deadlineMs =
    precisionBounds(claim).endMs + input.policy.windows.finalizeUnverifiableHours * MS_PER_HOUR;
  return instantMs(input.coverage.evaluatedAt) >= deadlineMs;
}

/** A rule decided by the claim alone: no observer can ever change it. */
function claimIntrinsic(rule: PolicyRule | null): boolean {
  return rule !== null && (rule.when.targetMissing === true || rule.when.underspecified === true);
}

/**
 * §7: an UNASKED receipt stays PENDING until the attributed agent's adapter has synced past the time a later
 * claim could still explain the orphan, or until `finalizeUnverifiableHours` after it happened.
 */
function unaskedFinal(input: FinalityInput): boolean {
  const { orphan, policy } = input;
  if (orphan === null) throw new GradeError('claimless_subject');
  // The same anchor attribution measures from (§7): when a calendar change was first seen, not the event start.
  const anchorMs = instantMs(isCalendarType(orphan.type) ? orphan.observedAt : orphan.occurredAt);
  const syncAt = input.context.attribution?.adapterLastSyncAt;
  const waitMs = (policy.windows.beforeClaimMin + policy.windows.graceMin) * MS_PER_MINUTE;
  if (syncAt !== undefined && instantMs(syncAt) >= anchorMs + waitMs) return true;
  const deadlineMs = anchorMs + policy.windows.finalizeUnverifiableHours * MS_PER_HOUR;
  return instantMs(input.coverage.evaluatedAt) >= deadlineMs;
}

function claimFinal(input: FinalityInput, claim: Claim): boolean {
  const { policy } = input;
  switch (input.outcome) {
    case 'VERIFIED':
      return syncedAt(input, claim, verifiedSyncMs(claim, policy));
    case 'PARTIAL':
    case 'NOT_FOUND':
      return syncedAt(input, claim, graceSyncMs(claim, policy));
    case 'OVER_SCOPE':
      return !input.candidateDependent || syncedAt(input, claim, graceSyncMs(claim, policy));
    case 'UNVERIFIABLE':
      if (claimIntrinsic(input.rule) || policy.sourcesByType[claim.type].length === 0) return true;
      return finalByTime(input, claim);
    case 'PENDING':
      return finalByTime(input, claim);
    case 'UNASKED':
      throw new GradeError('unasked_with_claim');
  }
}

/** §8: whether the receipt `grade()` is building is FINAL, and its `finalAt`. */
export function isFinalizable(input: FinalityInput): Finality {
  const final =
    input.claim === null
      ? input.outcome !== 'UNASKED' || unaskedFinal(input)
      : claimFinal(input, input.claim);
  return final ? { final, finalAt: input.coverage.evaluatedAt } : { final };
}
