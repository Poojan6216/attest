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
  /** `override` on a USER_OVERRIDDEN receipt: one override at a time; `revert` it first. */
  | 'already_overridden'
  /** `revert` on a PENDING or FINAL receipt: there is no override to undo. */
  | 'not_overridden'
  /** `supersede` on a receipt whose grade is not UNASKED: only UNASKED receipts are superseded. */
  | 'not_unasked'
  /** `regrade` with the receipt of another subject (a different id, §3): a regrade replaces its own row. */
  | 'subject_mismatch'
  /**
   * The stored receipt fails the Receipt schema, or its lifecycle reasons (`override.user`, `superseded`) are
   * not exactly the ones its `override` and `supersededBy` imply, last and in §15 order.
   */
  | 'invalid_receipt'
  /**
   * The event's payload is invalid: a `regrade` whose `next` is not a valid stored receipt or is
   * USER_OVERRIDDEN, an `override` that is not a valid ReceiptOverride (grade, visible reason, timestamp), a
   * `supersede` whose claimId is not a Ulid, or an event kind the machine does not know.
   */
  | 'invalid_event'
  /** The event is legal but its result breaks the schema (one reason more than SCHEMA_LIMITS.REASONS allows). */
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
