import type { DigestMark } from '../../../src/ledger/types';
import { AgentBadge } from '../../../src/ui/AgentBadge';
import { GradeChip } from '../../../src/ui/GradeChip';
import { gradeLabel } from '../../../src/ui/receipt-labels';

export interface MarkItemProps {
  readonly mark: DigestMark;
}

/**
 * One mark the person made on a receipt of the week (sprint_4 close, tech review TECH-4: "The override reason is
 * required and visible in the digest"): Attest's own grade first, the agent ("Likely agent" on an UNASKED receipt, Hard
 * Rule 7), then the person's grade and their reason, in their own words. Shown on this page only: no share holds it.
 */
export function MarkItem({ mark }: MarkItemProps) {
  return (
    <li class="flex flex-wrap items-center gap-2" data-receipt={mark.receiptId}>
      <GradeChip grade={mark.grade} />
      <AgentBadge agent={mark.agent} likely={mark.grade === 'UNASKED'} />
      <span>
        You marked it {gradeLabel(mark.markGrade)}: “{mark.reason}”
      </span>
    </li>
  );
}
