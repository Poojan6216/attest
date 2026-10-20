import type { ReceiptItem } from '../../../src/ledger/views';
import { count } from '../../../src/ui/labels';

/** Grades a person should look at (agents/ux_engineer.md rule 1): everything but Verified and Unverifiable. */
const NEEDS_A_LOOK: ReadonlySet<string> = new Set(['PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE']);

export interface VerdictLineProps {
  readonly items: readonly ReceiptItem[];
  /** True when today has more receipts than the popup shows: the counts then say "the latest". */
  readonly more: boolean;
  /** True when a source was not checked recently: "nothing needs a look" is then said only of what was checked (rule 2). */
  readonly gaps: boolean;
}

/**
 * The popup's answer in one line, above the receipts: how many of today's receipts need a look, and how many are
 * still being checked. It never says "all clear" (rule 2): with nothing to look at it says so only of what Attest
 * could check when a source has a gap.
 */
export function VerdictLine({ items, more, gaps }: VerdictLineProps) {
  if (items.length === 0) return null;
  const look = items.filter(({ receipt }) => NEEDS_A_LOOK.has(receipt.grade)).length;
  const checking = items.filter(({ receipt }) => receipt.state === 'PENDING').length;
  const of = more ? `of the latest ${String(items.length)}` : `of ${String(items.length)}`;
  const headline =
    look > 0
      ? `${String(look)} ${of} ${look === 1 ? 'needs' : 'need'} a look`
      : gaps
        ? 'Nothing needs a look in what Attest could check'
        : 'Nothing needs a look';
  const tone =
    look > 0
      ? 'border-grade-not-found-edge bg-grade-not-found-bg text-grade-not-found-fg'
      : 'border-rule bg-surface text-ink';
  return (
    <p role="status" class={`rounded-lg border px-3 py-2 text-sm font-medium ${tone}`}>
      {headline}
      {checking > 0 ? (
        <span class="font-normal text-ink-muted">
          , {count(checking, 'still checking', 'still checking')}
        </span>
      ) : null}
    </p>
  );
}
