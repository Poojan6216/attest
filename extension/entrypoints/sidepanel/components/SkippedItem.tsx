import type { PastedEntry } from '../../../src/adapters/paste';
import type { AgentId } from '../../../src/core/schema';
import { excerpt, keptTime, skippedReason } from '../../../src/ui/paste-labels';

export interface SkippedItemProps {
  readonly entry: PastedEntry & { readonly outcome: Exclude<PastedEntry['outcome'], 'claim'> };
  /** The agent whose working times the import keeps, or null when nothing is imported (the log has no claim). */
  readonly keptBy: AgentId | null;
}

/**
 * One entry the preview will not import as a claim: enough of its text to recognise it, its time as pasted, why, and
 * whether its time is kept as a time the agent was working (security review SEC-4).
 */
export function SkippedItem({ entry, keptBy }: SkippedItemProps) {
  return (
    <li>
      <span class="block">{excerpt(entry.text)}</span>
      <span class="block text-neutral-600 dark:text-neutral-400">
        {entry.time === null ? '' : `${entry.time}. `}
        {skippedReason(entry.outcome)}
        {entry.minute === null || keptBy === null ? '' : ` ${keptTime(keptBy)}`}
      </span>
    </li>
  );
}
