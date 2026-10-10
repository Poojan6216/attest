import type { Claim } from '../../../src/core/schema';
import { claimTypeLabel, claimWhat, claimWhen } from '../../../src/ui/labels';

export interface ClaimItemProps {
  readonly claim: Claim;
}

/** One claim the preview will import: what kind of action, who or what it names, and when the log says it happened. */
export function ClaimItem({ claim }: ClaimItemProps) {
  const what = claimWhat(claim);
  return (
    <li>
      <span class="font-medium">{claimTypeLabel(claim.type)}</span>
      {what !== null && <span>: {what}</span>}
      <span class="block text-neutral-600 dark:text-neutral-400">{claimWhen(claim)}</span>
    </li>
  );
}
