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
 *
 * `finalFrom` (v1.18), on a receipt that is not FINAL: the instant from which a later grading can make it FINAL. For
 * VERIFIED, the instant its sources must sync at or after (`end(p,t) + graceMin`). For PARTIAL, NOT_FOUND, an OVER_SCOPE
 * that rests on its candidate, and PENDING, the end of its grace (the `graceElapsed` instant): a grading whose sources
 * synced at or after it decides a final grade (PENDING becomes VERIFIED, PARTIAL or NOT_FOUND then). For the
 * coverage-based UNVERIFIABLE, the deadline it finalises at on time alone (`end(p,t) + finalizeUnverifiableHours`).
 * For UNASKED, the earlier of the instant its agent's adapter must sync at or after and its deadline. It is written in
 * the offset of `evaluatedAt`, so the UI shows "final from 14:48" from a stored value (sprint_4 4.2); every regrade
 * writes it again, so it follows the outcome.
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
import { instantMs, isoWithOffset } from './normalize';
import { anchorAt } from './order';
import type { PolicyRule, RuleOutcome } from './policy';
import { type Claim, type Coverage, type GradeContext, type Grant, IsoTs, type Observation } from './schema';
import { MS_PER_HOUR, MS_PER_MINUTE } from './units';
import { precisionBounds, writtenOffsetMinutes } from './window';

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
  /** The earliest instant from which a later grading can make it FINAL (header), present iff not `final`. */
  readonly finalFrom?: IsoTs;
}

function syncedAt(input: FinalityInput, claim: Claim, syncMs: number): boolean {
  const eligible = input.eligible ?? eligibleCoverage(claim, input.grant, input.coverage, input.policy);
  return everySourceSynced(eligible, syncMs);
}

/** `end(p,t) + finalizeUnverifiableHours`: the instant a receipt waiting on coverage finalises on time alone (§8). */
function deadlineMs(input: FinalityInput, claim: Claim): number {
  return precisionBounds(claim).endMs + input.policy.windows.finalizeUnverifiableHours * MS_PER_HOUR;
}

/** `evaluatedAt ≥ end(p,t) + finalizeUnverifiableHours`: nothing stays "checking" forever (§8). */
function finalByTime(input: FinalityInput, claim: Claim): boolean {
  return instantMs(input.coverage.evaluatedAt) >= deadlineMs(input, claim);
}

/** A rule decided by the claim alone: no observer can ever change it. */
function claimIntrinsic(rule: PolicyRule | null): boolean {
  return rule !== null && (rule.when.targetMissing === true || rule.when.underspecified === true);
}

/**
 * §7: an UNASKED receipt stays PENDING until the attributed agent's adapter has synced past the time a later
 * claim could still explain the orphan, or until `finalizeUnverifiableHours` after it happened.
 */
/** §7: the instant the agent's adapter must sync at or after, and the deadline, both from the orphan's anchor. */
function unaskedInstants(input: FinalityInput): { readonly syncMs: number; readonly deadlineMs: number } {
  const { orphan, policy } = input;
  if (orphan === null) throw new GradeError('claimless_subject');
  // The same anchor attribution measures from (§7, order.ts `anchorAt`): when a calendar change was first seen
  // (`sightedAt` when the ledger stored it later, else `observedAt`), not the event start.
  const anchorMs = instantMs(anchorAt(orphan));
  return {
    syncMs: anchorMs + (policy.windows.beforeClaimMin + policy.windows.graceMin) * MS_PER_MINUTE,
    deadlineMs: anchorMs + policy.windows.finalizeUnverifiableHours * MS_PER_HOUR,
  };
}

function unaskedFinal(input: FinalityInput): boolean {
  const { syncMs, deadlineMs: unaskedDeadlineMs } = unaskedInstants(input);
  const syncAt = input.context.attribution?.adapterLastSyncAt;
  if (syncAt !== undefined && instantMs(syncAt) >= syncMs) return true;
  return instantMs(input.coverage.evaluatedAt) >= unaskedDeadlineMs;
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

/** v1.18 (header): the earliest instant from which a later grading can make a claim's receipt FINAL. */
function claimFinalFromMs(input: FinalityInput, claim: Claim): number {
  const { policy } = input;
  switch (input.outcome) {
    case 'VERIFIED':
      return verifiedSyncMs(claim, policy);
    case 'PARTIAL':
    case 'NOT_FOUND':
    case 'OVER_SCOPE':
    case 'PENDING':
      return graceSyncMs(claim, policy);
    case 'UNVERIFIABLE':
      return deadlineMs(input, claim);
    case 'UNASKED':
      throw new GradeError('unasked_with_claim');
  }
}

/** `finalFrom` (header) for a receipt that is not FINAL, in the offset of `evaluatedAt`. */
function finalFromOf(input: FinalityInput): IsoTs {
  const { claim } = input;
  let fromMs: number;
  if (claim === null) {
    const { syncMs, deadlineMs: unaskedDeadlineMs } = unaskedInstants(input);
    fromMs = Math.min(syncMs, unaskedDeadlineMs);
  } else {
    fromMs = claimFinalFromMs(input, claim);
  }
  const { evaluatedAt } = input.coverage;
  return IsoTs.parse(isoWithOffset(fromMs, writtenOffsetMinutes(evaluatedAt)));
}

/** §8: whether the receipt `grade()` is building is FINAL, and its `finalAt`, or else its `finalFrom` (v1.18). */
export function isFinalizable(input: FinalityInput): Finality {
  const final =
    input.claim === null
      ? input.outcome !== 'UNASKED' || unaskedFinal(input)
      : claimFinal(input, input.claim);
  return final ? { final, finalAt: input.coverage.evaluatedAt } : { final, finalFrom: finalFromOf(input) };
}
