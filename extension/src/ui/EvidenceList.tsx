import { Fragment } from 'preact';

import type { Observation } from '../ledger/types';
import { evidenceFields, evidenceSummary } from './receipt-labels';

export interface EvidenceListProps {
  /** The evidence a receipt names, in its order. */
  readonly observations: readonly Observation[];
  /** Now, in epoch ms: a time today is written without its day. */
  readonly nowMs: number;
  /** What to say when the receipt names no evidence the ledger holds. */
  readonly emptyText?: string;
}

/**
 * A receipt's evidence (agents/ux_engineer.md rule 5): each piece in one specific line ("Sent email, 14:02, to
 * priya@example.com, “Q3 deck”"), then every field Attest stored about it, so nothing that fed the score is hidden.
 */
export function EvidenceList({ observations, nowMs, emptyText = 'No evidence.' }: EvidenceListProps) {
  if (observations.length === 0) return <p class="text-sm text-ink-muted">{emptyText}</p>;
  return (
    <ul aria-label="Evidence" class="space-y-row">
      {observations.map((observation) => (
        <li key={observation.id} class="rounded-md border border-rule p-row text-sm">
          <p class="font-medium text-ink">{evidenceSummary(observation, nowMs)}</p>
          <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {evidenceFields(observation, nowMs).map(([label, value]) => (
              <Fragment key={label}>
                <dt class="text-ink-muted">{label}</dt>
                <dd class="break-words text-ink">{value}</dd>
              </Fragment>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
