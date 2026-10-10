import type { ReceiptItem } from '../ledger/views';
import { AgentBadge } from './AgentBadge';
import { GradeChip } from './GradeChip';
import { count } from './paste-labels';
import { reasonLine, receiptLine, signalLines, statusLine } from './receipt-row-labels';

export interface ReceiptRowProps {
  readonly item: ReceiptItem;
  /** Now, in epoch ms: a time today is written without its day, and a past `finalFrom` reads as waiting. */
  readonly nowMs: number;
  /** The last grading batch's instant, or null before the first: a PENDING receipt graded before it is no longer checked. */
  readonly lastBatchMs: number | null;
  /** Opens the receipt's detail (the side panel); the row has no Open button without it (the popup). */
  readonly onOpen?: () => void;
}

/**
 * One receipt in a list (agents/ux_engineer.md rules 1, 4 and 6): the grade chip first, then the claim in one line,
 * then the agent ("Likely agent: …" for UNASKED), and in the side panel an Open button for its details; below, its status and why its
 * grade is what it is, and an UNASKED receipt's signals one tap away.
 */
export function ReceiptRow({ item, nowMs, lastBatchMs, onOpen }: ReceiptRowProps) {
  const { receipt } = item;
  const line = receiptLine(item, nowMs);
  const unasked = receipt.grade === 'UNASKED';
  const status = statusLine(receipt, nowMs, lastBatchMs);
  const reason = reasonLine(receipt);
  const signals = unasked ? signalLines(receipt) : [];
  return (
    <li class="py-row" data-receipt={receipt.id}>
      <div class="flex items-start gap-2">
        <GradeChip grade={receipt.grade} />
        <p class="min-w-0 flex-1 break-words text-sm text-ink">{line}</p>
        <AgentBadge agent={receipt.agent} likely={unasked} />
        {onOpen === undefined ? null : (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Open details: ${line}`}
            class="shrink-0 rounded border border-rule px-1.5 py-0.5 text-xs text-ink hover:bg-skeleton"
          >
            Open
          </button>
        )}
      </div>
      {status === null ? null : <p class="mt-0.5 text-xs text-ink-muted">{status}</p>}
      {reason === null ? null : <p class="mt-0.5 text-xs text-ink-muted">{reason}</p>}
      {signals.length === 0 ? null : (
        <details class="mt-0.5 text-xs text-ink-muted">
          <summary class="cursor-pointer">Why likely: {count(signals.length, 'signal', 'signals')}</summary>
          <ul class="mt-0.5 list-disc pl-4">
            {signals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
