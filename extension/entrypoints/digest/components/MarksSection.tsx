import type { DigestRecord } from '../../../src/ledger/types';
import { MarkItem } from './MarkItem';

export interface MarksSectionProps {
  readonly digest: DigestRecord;
}

/**
 * The person's marks on the week's receipts (sprint_4 close, tech review TECH-4: "The override reason is required and
 * visible in the digest"), each beside Attest's own grade; nothing when the week has none, or the digest was made
 * before marks were kept.
 */
export function MarksSection({ digest }: MarksSectionProps) {
  const marks = digest.marks ?? [];
  if (marks.length === 0) return null;
  const more = (digest.marksCount ?? 0) - marks.length;
  return (
    <section aria-labelledby="marks-heading" class="space-y-2">
      <h2 id="marks-heading" class="text-base font-semibold">
        Your marks
      </h2>
      <p class="text-ink-muted">Attest’s own grade stays beside each. A share never holds your reasons.</p>
      <ul class="space-y-2">
        {marks.map((mark) => (
          <MarkItem key={mark.receiptId} mark={mark} />
        ))}
      </ul>
      {more > 0 ? <p>And {String(more)} more, in the side panel’s timeline.</p> : null}
    </section>
  );
}
