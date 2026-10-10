import type { NotableReceipt } from '../../../src/ledger/types';
import { AgentBadge } from '../../../src/ui/AgentBadge';
import { instantLabel } from '../../../src/ui/digest-labels';
import { formatAmount } from '../../../src/ui/format';
import { GradeChip } from '../../../src/ui/GradeChip';
import { claimTypeLabel } from '../../../src/ui/paste-labels';

export interface NotableItemProps {
  readonly receipt: NotableReceipt;
}

/**
 * A receipt the week calls out (sprint_4 4.7): its grade first, the agent ("Likely agent" on an UNASKED one, Hard Rule
 * 7), then the action, its time, the counterparty's domain, the amount and the subject hint, as the digest kept them.
 */
export function NotableItem({ receipt }: NotableItemProps) {
  const { grade, agent, type, at, domain, amountCents, currency, subjectHint } = receipt;
  const parts = [
    type === undefined ? undefined : claimTypeLabel(type),
    at === undefined ? undefined : instantLabel(at),
    domain,
    amountCents === undefined ? undefined : formatAmount(amountCents, currency),
    subjectHint === undefined ? undefined : `“${subjectHint}”`,
  ].filter((part) => part !== undefined);
  return (
    <li class="flex flex-wrap items-center gap-2" data-receipt={receipt.receiptId}>
      <GradeChip grade={grade} />
      <AgentBadge agent={agent} likely={grade === 'UNASKED'} />
      <span>{parts.join(', ')}</span>
    </li>
  );
}
