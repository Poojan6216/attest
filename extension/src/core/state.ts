/**
 * The receipt state machine (docs/grading.md §8; module contract §13). `transition(receipt, event)` applies one
 * user or lifecycle event to a stored receipt and returns a new receipt; the input is never mutated.
 *
 *   PENDING ───────── regrade(next) ─────────▶ next  (PENDING or FINAL, as grade() decided)
 *   PENDING | FINAL ── override(grade, reason, at) ─▶ USER_OVERRIDDEN  (previousState stored)
 *   USER_OVERRIDDEN ── revert ────────────────▶ previousState  (the exact prior receipt)
 *   UNASKED, any state ── supersede(claimId) ─▶ the same state, supersededBy = claimId
 *
 * Every other (state, event) pair throws IllegalTransitionError with a code. This module never decides
 * finality: grade() sets `state` and `finalAt` (conditions.isFinalizable), and `regrade` only installs grade()'s
 * next receipt in place of a PENDING one. No event but `regrade` changes a computed field (`grade`, `ruleId`,
 * `confidence`, `signals`, the graded reasons, `finalAt`, …): an override sits beside the computed grade, so
 * replay shows an override, never a changed grade.
 *
 * Lifecycle reasons (§15): `override.user` {grade} while overridden and `superseded` {claimId} while superseded,
 * always after the graded reasons and in table order. They are derived from `override` and `supersededBy`, and
 * a stored receipt whose lifecycle reasons disagree with those fields is rejected, so `revert` restores the
 * exact receipt that was overridden. Every result is parsed with the Receipt schema, so it satisfies the receipt
 * invariants (override iff USER_OVERRIDDEN, finalAt iff FINAL before any override, attribution and
 * supersededBy on UNASKED only).
 *
 * PURE: no clock, no I/O, no logging (Hard Rule 4).
 */
import { canonicalJson } from './hash';
import { type Reason, Receipt, ReceiptOverride, type ReceiptState, Ulid } from './schema';
import { IllegalTransitionError } from './state-error';

export {
  type IllegalTransitionCode,
  IllegalTransitionError,
  RECEIPT_EVENTS,
  type ReceiptEventKind,
} from './state-error';

/** The grades a user may assert (§8): the claim happened, or it did not. */
export type OverrideGrade = ReceiptOverride['grade'];

/**
 * One event (§8). Payload fields are validated by `transition` (ReceiptOverride, Ulid), so a caller may pass
 * them as plain strings; an extra property (a runner's `receiptId`) is ignored.
 */
export type ReceiptEvent =
  /** Install grade()'s next receipt for the same subject. */
  | { readonly event: 'regrade'; readonly next: Receipt }
  /** The user asserts a grade with a reason; the computed grade stays beside it. */
  | {
      readonly event: 'override';
      readonly grade: OverrideGrade;
      readonly reason: string;
      readonly at: string;
    }
  /** Undo the override (Sprint 4.3: overrides are reversible). */
  | { readonly event: 'revert' }
  /** A claim was later assigned this UNASKED receipt's observation (§7). */
  | { readonly event: 'supersede'; readonly claimId: string };

const LIFECYCLE_CODES: ReadonlySet<Reason['code']> = new Set(['override.user', 'superseded']);

/** The reasons grade() computed: every reason except the lifecycle ones. */
function gradedReasons(reasons: readonly Reason[]): Reason[] {
  return reasons.filter((reason) => !LIFECYCLE_CODES.has(reason.code));
}

/** The lifecycle reasons a receipt's override and supersession imply, in §15 table order. */
function lifecycleReasons(receipt: Pick<Receipt, 'override' | 'supersededBy'>): Reason[] {
  const reasons: Reason[] = [];
  if (receipt.override !== undefined) {
    reasons.push({ code: 'override.user', params: { grade: receipt.override.grade } });
  }
  if (receipt.supersededBy !== undefined) {
    reasons.push({ code: 'superseded', params: { claimId: receipt.supersededBy } });
  }
  return reasons;
}

/** The receipt's reasons are its graded reasons followed by exactly the lifecycle reasons its fields imply. */
function lifecycleConsistent(receipt: Receipt): boolean {
  const expected = [...gradedReasons(receipt.reasons), ...lifecycleReasons(receipt)];
  return canonicalJson(expected) === canonicalJson(receipt.reasons);
}

/** A stored receipt as the schema reads it, with consistent lifecycle reasons; else `invalid_receipt`. */
function parseStored(receipt: Receipt): Receipt {
  const parsed = Receipt.safeParse(receipt);
  if (!parsed.success || !lifecycleConsistent(parsed.data)) {
    throw new IllegalTransitionError('invalid_receipt', undefined);
  }
  return parsed.data;
}

/** Rebuild the lifecycle reasons from the new fields and parse the result; `from` names the source state. */
function finish(fields: Receipt, from: ReceiptState): Receipt {
  const reasons = [...gradedReasons(fields.reasons), ...lifecycleReasons(fields)];
  const parsed = Receipt.safeParse({ ...fields, reasons });
  if (!parsed.success) throw new IllegalTransitionError('invalid_result', from);
  return parsed.data;
}

/** PENDING → next. FINAL receipts are never re-graded, and an overridden receipt is not either (§8). */
function regrade(current: Receipt, next: Receipt): Receipt {
  if (current.state === 'FINAL') throw new IllegalTransitionError('regrade_final', current.state);
  if (current.state === 'USER_OVERRIDDEN') {
    throw new IllegalTransitionError('regrade_overridden', current.state);
  }
  const parsed = Receipt.safeParse(next);
  if (!parsed.success || parsed.data.state === 'USER_OVERRIDDEN' || !lifecycleConsistent(parsed.data)) {
    throw new IllegalTransitionError('invalid_event', current.state);
  }
  if (parsed.data.id !== current.id) throw new IllegalTransitionError('subject_mismatch', current.state);
  return parsed.data;
}

/** PENDING | FINAL → USER_OVERRIDDEN, storing previousState; the computed grade and finalAt are kept. */
function override(current: Receipt, event: Extract<ReceiptEvent, { event: 'override' }>): Receipt {
  if (current.state === 'USER_OVERRIDDEN') {
    throw new IllegalTransitionError('already_overridden', current.state);
  }
  const parsed = ReceiptOverride.safeParse({
    grade: event.grade,
    reason: event.reason,
    at: event.at,
    previousState: current.state,
  });
  if (!parsed.success) throw new IllegalTransitionError('invalid_event', current.state);
  return finish({ ...current, state: 'USER_OVERRIDDEN', override: parsed.data }, current.state);
}

/** USER_OVERRIDDEN → previousState, removing the override and its reason. */
function revert(current: Receipt): Receipt {
  const { override: stored, ...rest } = current;
  // The schema guarantees `override` on a USER_OVERRIDDEN receipt; the second test narrows its type.
  if (current.state !== 'USER_OVERRIDDEN' || stored === undefined) {
    throw new IllegalTransitionError('not_overridden', current.state);
  }
  return finish({ ...rest, state: stored.previousState }, current.state);
}

/** UNASKED receipts only, in any state: set (or replace) supersededBy; the state is unchanged. */
function supersede(current: Receipt, claimId: string): Receipt {
  if (current.grade !== 'UNASKED') throw new IllegalTransitionError('not_unasked', current.state);
  const parsed = Ulid.safeParse(claimId);
  if (!parsed.success) throw new IllegalTransitionError('invalid_event', current.state);
  return finish({ ...current, supersededBy: parsed.data }, current.state);
}

/** An event kind outside the union reached `transition` at run time. */
function unknownEvent(_event: never, from: ReceiptState): never {
  throw new IllegalTransitionError('invalid_event', from);
}

/**
 * Apply one event to a stored receipt (§8). Throws IllegalTransitionError when the receipt is invalid
 * (`invalid_receipt`), when the (state, event) pair is illegal, or when the event's payload is invalid; on a
 * throw nothing changes. The result always parses with the Receipt schema.
 */
export function transition(receipt: Receipt, event: ReceiptEvent): Receipt {
  const current = parseStored(receipt);
  switch (event.event) {
    case 'regrade':
      return regrade(current, event.next);
    case 'override':
      return override(current, event);
    case 'revert':
      return revert(current);
    case 'supersede':
      return supersede(current, event.claimId);
    default:
      return unknownEvent(event, current.state);
  }
}
