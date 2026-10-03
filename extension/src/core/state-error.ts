/**
 * The typed error of the receipt state machine (docs/grading.md §8; module contract §13). A leaf module: it
 * imports only types, so state.ts and its callers share one error without a cycle. PURE (Hard Rule 4).
 *
 * The message names only the code and the state the receipt was in, never an override reason or any other
 * user text, so a caller may log it as is (Hard Rule 10).
 */
import type { ReceiptState } from './schema';

/** The events `transition` applies (§8), in the order the contract lists them. */
export const RECEIPT_EVENTS = Object.freeze(['regrade', 'override', 'revert', 'supersede'] as const);

export type ReceiptEventKind = (typeof RECEIPT_EVENTS)[number];

export type IllegalTransitionCode =
  /** `regrade` on a FINAL receipt: FINAL receipts are never re-graded; grant changes affect PENDING only. */
  | 'regrade_final'
  /** `regrade` on a USER_OVERRIDDEN receipt: an overridden receipt is never regraded. */
  | 'regrade_overridden'
  /**
   * `regrade` on a superseded receipt: its observation is fixed to the superseding FINAL claim, so the caller
   * deletes a PENDING one instead (§8); regrading would silently drop `supersededBy`.
   */
  | 'regrade_superseded'
  /** `override` on a USER_OVERRIDDEN receipt: one override at a time; `revert` it first. */
  | 'already_overridden'
  /** `revert` on a PENDING or FINAL receipt: there is no override to undo. */
  | 'not_overridden'
  /** `supersede` on a receipt whose grade is not UNASKED: only UNASKED receipts are superseded. */
  | 'not_unasked'
  /** `regrade` with the receipt of another subject (a different id, §3): a regrade replaces its own row. */
  | 'subject_mismatch'
  /** `regrade` with a receipt computed before the stored one (`next.computedAt < computedAt`, as instants). */
  | 'regrade_stale'
  /**
   * `regrade` of an UNASKED receipt with a receipt of another grade: a PENDING UNASKED that re-evaluates to
   * anything else is deleted by the caller, never regraded (§7, §8).
   */
  | 'regrade_not_unasked'
  /**
   * `regrade` with a receipt computed while one of the stored receipt's reverted overrides was still in force
   * (§8; schema-receipt.ts `revertedHoldsAt`): that batch left the claim out, or had the orphan taken, so it cannot
   * have graded it. A caller that passes such a claim to a batch would make the ledger disagree with replay.
   */
  | 'regrade_held'
  /**
   * The stored receipt fails the Receipt schema, or its lifecycle reasons (`override.user`, `superseded`) are
   * not exactly the ones its `override` and `supersededBy` imply, last and in §15 order.
   */
  | 'invalid_receipt'
  /**
   * The event's payload is invalid: a `regrade` whose `next` is not a valid stored receipt or is not grade()'s
   * output (USER_OVERRIDDEN, superseded, or with reverted overrides), an `override` that is not a valid
   * ReceiptOverride (grade, visible reason, timestamp) or whose `at` is before the receipt's `computedAt` or its
   * last revert, a `revert` whose `at` is not a timestamp or is before the override's `at`, a `supersede` whose
   * claimId is not a Ulid, or an event kind the machine does not know.
   */
  | 'invalid_event'
  /**
   * The event is legal but its result breaks the schema: one reason more than SCHEMA_LIMITS.REASONS allows, or one
   * reverted override more than the schema keeps.
   */
  | 'invalid_result';

/** Fail loud (Hard Rule 6): an event that the state machine cannot apply never changes a stored receipt. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly code: IllegalTransitionCode,
    /** The state of the receipt the event was applied to; absent when that receipt was itself invalid. */
    readonly from: ReceiptState | undefined,
  ) {
    super(from === undefined ? `state: ${code}` : `state: ${code} (from ${from})`);
    this.name = 'IllegalTransitionError';
  }
}
