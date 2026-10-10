/**
 * What a receipt row says (sprint_4 4.2; agents/ux_engineer.md rules 1, 4 and 6): its one line (the claim, or what an
 * UNASKED receipt is about), its status ("Checking — final from 14:48", an override, or a receipt the batches no longer
 * grade), why a grade that is no verification is what it is, and an UNASKED receipt's signals. The reasons are the
 * stored ones in words (src/core/reason-text.ts) and every time is a stored instant (`finalFrom`, `computedAt`). Pure:
 * the caller passes now and the last batch instant.
 */
import { reasonText } from '../core/reason-text';
import type { Reason, Receipt } from '../ledger/types';
import type { ReceiptItem } from '../ledger/views';
import { clockTime } from './format';
import { claimTypeLabel, claimWhat, count } from './labels';
import { evidenceSummary, gradeLabel } from './receipt-labels';

/** The row's one line: the claim as extracted, what an UNASKED receipt is about, or a scope receipt's finding. */
export function receiptLine(item: ReceiptItem, nowMs: number): string {
  const { receipt, claim, orphan } = item;
  if (receipt.claimId !== undefined) {
    if (claim === undefined) return 'A claim Attest no longer keeps';
    const what = claimWhat(claim);
    return what === null ? claimTypeLabel(claim.type) : `${claimTypeLabel(claim.type)}: ${what}`;
  }
  if (receipt.grade === 'UNASKED') {
    const signals = count(signalLines(receipt).length, 'signal', 'signals');
    return orphan === undefined
      ? `An action Attest no longer keeps (${signals})`
      : `${evidenceSummary(orphan, nowMs)} (${signals})`;
  }
  const [first] = receipt.reasons;
  return first === undefined ? gradeLabel(receipt.grade) : reasonText(first);
}

/**
 * The row's status: an override and its reason; for a PENDING receipt, from when it can be final (`finalFrom`), or that
 * the batches no longer grade it (graded before the last batch: a claim-less receipt that holds reverted overrides,
 * which must not read as "checking" forever); a superseded UNASKED receipt's explanation. Null for a FINAL receipt.
 */
export function statusLine(receipt: Receipt, nowMs: number, lastBatchMs: number | null): string | null {
  const { override } = receipt;
  if (override !== undefined) return `You marked it ${gradeLabel(override.grade)}: “${override.reason}”`;
  const superseded = receipt.reasons.find(({ code }) => code === 'superseded');
  if (superseded !== undefined) return reasonText(superseded);
  if (receipt.state !== 'PENDING') return null;
  if (lastBatchMs !== null && Date.parse(receipt.computedAt) < lastBatchMs) {
    return `No longer checked since ${clockTime(receipt.computedAt, nowMs)}`;
  }
  if (receipt.finalFrom === undefined) return 'Checking';
  const from = clockTime(receipt.finalFrom, nowMs);
  return nowMs < Date.parse(receipt.finalFrom)
    ? `Checking — final from ${from}`
    : `Checking — waiting for a check after ${from}`;
}

/** The reasons that say why a grade is what it is, by grade (the rule's own and coverage reasons, §15). */
const EXPLAINING: Readonly<Partial<Record<Receipt['grade'], (code: Reason['code']) => boolean>>> = {
  UNVERIFIABLE: (code) => code.startsWith('coverage.') || code.startsWith('claim.'),
  OVER_SCOPE: (code) => code.startsWith('scope.') || code.startsWith('ceiling.'),
  NOT_FOUND: (code) => code === 'match.none',
};

/** Why an UNVERIFIABLE, OVER_SCOPE or NOT_FOUND receipt is what it is: its first explaining reason, in words. */
export function reasonLine(receipt: Receipt): string | null {
  const explains = EXPLAINING[receipt.grade];
  const reason = explains === undefined ? undefined : receipt.reasons.find(({ code }) => explains(code));
  return reason === undefined ? null : reasonText(reason);
}

/** An UNASKED receipt's signals, each in words, each saying "likely" (Hard Rule 7). */
export function signalLines(receipt: Receipt): string[] {
  return receipt.reasons
    .filter(({ code }) => code.startsWith('unasked.'))
    .map((reason) => reasonText(reason));
}
