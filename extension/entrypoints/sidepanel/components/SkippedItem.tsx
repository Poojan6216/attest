import type { PastedEntry } from '../../../src/adapters/paste';
import { excerpt, skippedReason } from '../../../src/ui/paste-labels';

export interface SkippedItemProps {
  readonly entry: PastedEntry & { readonly outcome: Exclude<PastedEntry['outcome'], 'claim'> };
}

/** One entry the preview will not import: enough of its text to recognise it, its time as pasted, and why. */
export function SkippedItem({ entry }: SkippedItemProps) {
  return (
    <li>
      <span class="block">{excerpt(entry.text)}</span>
      <span class="block text-neutral-600 dark:text-neutral-400">
        {entry.time === null ? '' : `${entry.time}. `}
        {skippedReason(entry.outcome)}
      </span>
    </li>
  );
}
