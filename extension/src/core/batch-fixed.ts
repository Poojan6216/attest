/**
 * Pre-assignments (docs/grading.md §4.3, §8, §9): which observations the FINAL and USER_OVERRIDDEN receipts fix, and
 * in which batches. Written once, for both readers: `gradeBatch` (batch.ts) keeps the pairs in force at its own
 * `evaluatedAt`, and replay (replay-timeline.ts) derives the same pairs from the stored receipts and keeps those in
 * force at each batch instant, so a batch and its replay fix exactly the same pairs (Hard Rule 4).
 *
 * A pair is in force in a batch whose `evaluatedAt` is strictly after its `after`, at or before its `until` when it
 * has one, and outside each of its `released` spans. `preAssignments(receipts)` reads them off each claim's latest
 * receipt. A claim pair's `after` is always a grading of its claim, so it is before every later batch (batch.ts
 * refuses a batch that is not, `stale_evaluated_at`): every pair of a claim starts strictly after the grading it
 * records (its own batch graded it, so nothing is fixed there; a later batch either regraded it, which would have
 * moved `computedAt`, or left it out as FINAL or overridden, §4.3):
 *  - a receipt FINAL before any override fixes its `observationIds` to its claim; an override to NOT_FOUND releases
 *    them in batches after the override's `at` (a `released` span with no end), an override to VERIFIED keeps them;
 *  - a receipt PENDING until an override to VERIFIED fixes its `observationIds` too: every batch after its last
 *    grading left the claim out, because the override was already written when that batch read it (even one
 *    evaluated before the override's `at`) or an earlier override since reverted still held the claim there (then
 *    from that revert on), so the stored evidence was never free for another claim there (left free,
 *    another claim could take it FINAL and the next batch would find one observation fixed to two claims,
 *    `CandidatesError('fixed_conflict')`); one overridden to NOT_FOUND fixes nothing;
 *  - an overridden UNASKED receipt (claim-less, naming its orphan) takes that observation after the override's `at`
 *    (claim `null`; after its `computedAt` when that is later); a FINAL UNASKED receipt takes nothing: its
 *    observation stays assignable (§7), so an override is what takes it.
 * A reverted override (the receipt's `reverted`, state.ts) stays in force for the batches evaluated up to its
 * `revertedAt`, so a revert never erases what a batch saw: an override from PENDING to VERIFIED fixed the evidence
 * it sat beside up to the revert (`until`; from the revert of the override before it, when one held the claim since
 * the same grading); a taken orphan was taken up to the revert (`until`); an override from FINAL to NOT_FOUND
 * released the FINAL evidence from its `at` to its `revertedAt` (a closed `released` span). What a revert fixes again
 * it fixes only if no other claim holds that observation then: batch-fixed-claims.ts keeps each claim's spells in
 * the order they begin and drops one that begins while another claim holds the observation, so a released
 * observation is never fixed again to a claim while another claim holds it, and never to two claims at once. A
 * claim whose reverted override is still in force is left out of the batch like an overridden one (`heldOutAt`).
 * An override or a revert releases, takes or restores an observation strictly after its instant: one stamped at a
 * batch's very `evaluatedAt`, or after it but before that batch read its pre-assignments, does nothing in that
 * batch, on both sides. The caller's duty (§3): read the claims and the pre-assignments of a batch, grade them and
 * write the result in one transaction begun after stamping `evaluatedAt`, stamp each batch strictly after the last,
 * and stamp each override's `at` and each revert's instant inside the transaction that writes it, so that every
 * event stamped before `evaluatedAt` is in what the batch read.
 *
 * Nothing here reads a stored `grade` or `ruleId`, so a tampered grade changes no other receipt's pre-assignments.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import { type BatchFixed, claimPairs, type Release } from './batch-fixed-claims';

export type { BatchFixed, Release } from './batch-fixed-claims';
import type { FixedPair } from './candidates';
import { instantMs } from './normalize';
import { compareText } from './order';
import type { IsoTs, Receipt, Ulid } from './schema';
import { revertedHoldsAt } from './schema-receipt';

/** The pre-assignments in force at one instant (§4.3 `assign(pairs, policy, fixed, taken)`). */
export interface FixedAt {
  /** In claim id, then observation id order. */
  readonly fixed: readonly FixedPair[];
  readonly taken: ReadonlySet<Ulid>;
}

/** Whether a batch evaluated at `evaluatedMs` is inside `span`. Throws for an instant that is not an IsoTs. */
function releasedAt(span: Release, evaluatedMs: number): boolean {
  if (instantMs(span.from) >= evaluatedMs) return false;
  return span.to === undefined || evaluatedMs <= instantMs(span.to);
}

/** Whether `pair` is in force in a batch evaluated at `evaluatedMs`. Throws for an instant not an IsoTs. */
export function inForceAt(pair: BatchFixed, evaluatedMs: number): boolean {
  if (instantMs(pair.after) >= evaluatedMs) return false;
  if (pair.until !== undefined && evaluatedMs > instantMs(pair.until)) return false;
  return !(pair.released?.some((span) => releasedAt(span, evaluatedMs)) ?? false);
}

/** The pairs of `fixed` in force at `evaluatedMs`: fixed to a claim, or taken. */
export function fixedInForce(fixed: readonly BatchFixed[], evaluatedMs: number): FixedAt {
  const pairs: FixedPair[] = [];
  const taken = new Set<Ulid>();
  for (const pair of fixed) {
    if (!inForceAt(pair, evaluatedMs)) continue;
    if (pair.claimId === null) taken.add(pair.observationId);
    else pairs.push({ observationId: pair.observationId, claimId: pair.claimId });
  }
  pairs.sort((a, b) => compareText(a.claimId, b.claimId) || compareText(a.observationId, b.observationId));
  return { fixed: pairs, taken };
}

/**
 * Whether a batch evaluated at `evaluatedMs` leaves the subject of `receipt` out because one of its reverted
 * overrides is still in force there (§8): a claim from the grading the override sat beside up to the revert, an
 * orphan from the override's `at` (it was taken) up to the revert.
 */
export function heldOutAt(receipt: Receipt, evaluatedMs: number): boolean {
  const claimless = receipt.claimId === undefined;
  return (receipt.reverted ?? []).some((entry) => revertedHoldsAt(entry, claimless, evaluatedMs));
}

/**
 * Whether a batch evaluated at `evaluatedMs` grades the claim whose stored receipt is `receipt` (§3): PENDING, and
 * no reverted override of it still in force there. The background passes exactly these claims to `gradeBatch`.
 */
export function gradedAt(receipt: Receipt, evaluatedMs: number): boolean {
  return receipt.state === 'PENDING' && !heldOutAt(receipt, evaluatedMs);
}

/** (`computedAt` instant, id): the later grading of one subject. */
function isLater(a: Receipt, b: Receipt): boolean {
  const [aMs, bMs] = [instantMs(a.computedAt), instantMs(b.computedAt)];
  if (aMs !== bMs) return aMs > bMs;
  return a.id > b.id;
}

/**
 * The claim receipts by claim id, one per claim: the ledger keeps one row per subject, and of two rows for one claim
 * (a corrupt ledger) the later grading wins (`computedAt` instant, then id).
 */
export function latestClaimReceipts(receipts: Iterable<Receipt>): Map<Ulid, Receipt> {
  const latest = new Map<Ulid, Receipt>();
  for (const receipt of receipts) {
    if (receipt.claimId === undefined) continue;
    const held = latest.get(receipt.claimId);
    if (held === undefined || isLater(receipt, held)) latest.set(receipt.claimId, receipt);
  }
  return latest;
}

/** The later of two instants, as written. */
function laterOf(a: IsoTs, b: IsoTs): IsoTs {
  return instantMs(b) > instantMs(a) ? b : a;
}

/** What one claim-less receipt takes: its orphan, while each override (reverted or in force) was in force. */
function takenPairs(receipt: Receipt): BatchFixed[] {
  const [orphan] = receipt.observationIds;
  if (receipt.claimId !== undefined || orphan === undefined) return [];
  const pairs: BatchFixed[] = (receipt.reverted ?? []).map((entry) => ({
    observationId: orphan,
    claimId: null,
    after: laterOf(entry.computedAt, entry.at),
    until: entry.revertedAt,
  }));
  const { override } = receipt;
  if (override !== undefined) {
    pairs.push({ observationId: orphan, claimId: null, after: laterOf(receipt.computedAt, override.at) });
  }
  return pairs;
}

/**
 * Every pre-assignment the stored `receipts` make (§4.3; see the file comment), each with the batches it is in force
 * in: what the background passes to `gradeBatch` (which keeps those in force at its `evaluatedAt`), and what replay
 * rebuilds each batch with. Claim receipts first, in claim id order (each claim's reverted spans, then its current
 * evidence), then the taken orphans in receipt order.
 */
export function preAssignments(receipts: Iterable<Receipt>): BatchFixed[] {
  const held = [...receipts];
  const latest = [...latestClaimReceipts(held)].sort(([a], [b]) => compareText(a, b));
  const fixed = claimPairs(latest);
  for (const receipt of held) fixed.push(...takenPairs(receipt));
  return fixed;
}
