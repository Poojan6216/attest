import type { CoverageSummary } from '../ledger/views';
import { coverageLines } from './receipt-labels';

export interface CoverageHeaderProps {
  readonly coverage: CoverageSummary;
  /** Now, in epoch ms: what "checked" and "not checked since" are measured against. */
  readonly nowMs: number;
}

/**
 * What Attest has checked, at the top of the popup and the side panel (agents/ux_engineer.md rule 2; the sprint's most
 * important component): each source's last check, or that it was not checked, and when each agent's activity was last
 * added. A line that is not current is drawn in the degraded yellow and says "not checked" in words, so no green chip
 * below it reads as all clear.
 */
export function CoverageHeader({ coverage, nowMs }: CoverageHeaderProps) {
  return (
    <section aria-label="What Attest has checked" class="text-xs">
      <ul class="flex flex-wrap gap-x-2 gap-y-1">
        {coverageLines(coverage, nowMs).map((line) => (
          <li
            key={line.key}
            class={
              line.current
                ? 'py-0.5 text-ink-muted'
                : 'rounded border border-degraded-edge bg-degraded-bg px-1 py-0.5 font-medium text-degraded-fg'
            }
          >
            {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
