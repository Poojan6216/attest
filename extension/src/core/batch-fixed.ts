/**
 * Pre-assignments (docs/grading.md §4.3, §8, §9): which observations the FINAL and USER_OVERRIDDEN receipts fix, and
 * in which batches. Written once, for both readers: `gradeBatch` (batch.ts) keeps the pairs in force at its own
 * `evaluatedAt`, and replay (replay-timeline.ts) derives the same pairs from the stored receipts and keeps those in
 * force at each batch instant, so a batch and its replay fix exactly the same pairs (Hard Rule 4).
 *
 * A pair is in force in a batch whose `evaluatedAt` is strictly after its `after`, and, when it has an `until`, at
 * or before its `until`. `preAssignments(receipts)` reads them off each claim's latest receipt; every pair of a claim
 * starts strictly after its `computedAt`, the claim's last grading (its own batch graded it, so nothing is fixed
 * there; a later batch either regraded it, which would have moved `computedAt`, or left it out as FINAL or
 * overridden, §4.3):
 *  - a receipt FINAL before any override fixes its `observationIds` to its claim; an override to NOT_FOUND ends that
 *    at the override's `at` (`until`), an override to VERIFIED keeps it;
 *  - a receipt PENDING until an override to VERIFIED fixes its `observationIds` too: every batch after its last
 *    grading left the claim out because the override was already written when that batch read it, even one
 *    evaluated before the override's `at`, so the stored evidence was never free for another claim there (left free,
 *    another claim could take it FINAL and the next batch would find one observation fixed to two claims,
 *    `CandidatesError('fixed_conflict')`); one overridden to NOT_FOUND fixes nothing;
 *  - an overridden UNASKED receipt (claim-less, naming its orphan) takes that observation after the override's `at`
 *    (claim `null`; after its `computedAt` when that is later); a FINAL UNASKED receipt takes nothing: its
 *    observation stays assignable (§7), so an override is what takes it.
 * An override that releases or takes an observation does so strictly after its `at`: one stamped at a batch's very
 * `evaluatedAt`, or after it but before that batch read its pre-assignments, is not in force in that batch, on both
 * sides. The caller's duty (§3): read the claims and the pre-assignments of a batch, grade them and write the result
 * in one transaction begun after stamping `evaluatedAt`, and stamp each override's `at` inside the transaction that
 * writes it, so that every override stamped before `evaluatedAt` is in what the batch read.
 *
 * Nothing here reads a stored `grade` or `ruleId`, so a tampered grade changes no other receipt's pre-assignments.
 *
 * PURE: no I/O, no clock, no logging (Hard Rule 4).
 */
import type { FixedPair } from './candidates';
import { instantMs } from './normalize';
import { compareText } from './order';
import type { IsoTs, Receipt, Ulid } from './schema';

/** One pre-assignment and the batches it is in force in (see the file comment). */
export interface BatchFixed {
  readonly observationId: Ulid;
  /** The claim the observation is fixed to; null: taken (an overridden UNASKED receipt's orphan). */
  readonly claimId: Ulid | null;
  /** In force only in batches whose `evaluatedAt` is strictly after this instant. */
  readonly after: IsoTs;
  /** When present, in force only in batches whose `evaluatedAt` is at or before this instant. */
  readonly until?: IsoTs;
}

/** The pre-assignments in force at one instant (§4.3 `assign(pairs, policy, fixed, taken)`). */
export interface FixedAt {
  /** In claim id, then observation id order. */
  readonly fixed: readonly FixedPair[];
  readonly taken: ReadonlySet<Ulid>;
}

/** Whether `pair` is in force in a batch evaluated at `evaluatedMs`. Throws for an `after`/`until` not an IsoTs. */
export function inForceAt(pair: BatchFixed, evaluatedMs: number): boolean {
  if (instantMs(pair.after) >= evaluatedMs) return false;
  return pair.until === undefined || evaluatedMs <= instantMs(pair.until);
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

/** What one claim receipt fixes (see the file comment): after its `computedAt`, until a releasing override's `at`. */
function claimPairs(receipt: Receipt, claimId: Ulid): BatchFixed[] {
  const { override, observationIds, computedAt } = receipt;
  const before = override?.previousState ?? receipt.state;
  if (before !== 'FINAL' && override?.grade !== 'VERIFIED') return [];
  const until = override?.grade === 'NOT_FOUND' ? { until: override.at } : {};
  return observationIds.map((observationId) => ({ observationId, claimId, after: computedAt, ...until }));
}

/**
 * Every pre-assignment the stored `receipts` make (§4.3; see the file comment), each with the batches it is in force
 * in: what the background passes to `gradeBatch` (which keeps those in force at its `evaluatedAt`), and what replay
 * rebuilds each batch with. Claim receipts first, in claim id order, then the taken orphans in receipt order.
 */
export function preAssignments(receipts: Iterable<Receipt>): BatchFixed[] {
  const held = [...receipts];
  const latest = [...latestClaimReceipts(held)].sort(([a], [b]) => compareText(a, b));
  const fixed = latest.flatMap(([claimId, receipt]) => claimPairs(receipt, claimId));
  for (const receipt of held) {
    const [orphan] = receipt.observationIds;
    const { override } = receipt;
    if (receipt.claimId !== undefined || override === undefined || orphan === undefined) continue;
    fixed.push({ observationId: orphan, claimId: null, after: laterOf(receipt.computedAt, override.at) });
  }
  return fixed;
}
