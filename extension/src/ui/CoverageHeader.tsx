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
 * added. A gap comes first and stays loud, in the degraded yellow and in words ("not checked"), so no green chip below
 * it reads as all clear; every current line is quiet, one muted item with a green dot (drawn by CSS, not text).
 */
export function CoverageHeader({ coverage, nowMs }: CoverageHeaderProps) {
  const lines = coverageLines(coverage, nowMs);
  const ordered = [...lines.filter((line) => !line.current), ...lines.filter((line) => line.current)];
  return (
    <section aria-label="What Attest has checked" class="text-xs">
      <ul class="flex flex-wrap items-center gap-x-3 gap-y-1">
        {ordered.map((line) => (
          <li
            key={line.key}
            class={
              line.current
                ? "py-0.5 text-ink-muted before:mr-1 before:inline-block before:size-1.5 before:rounded-full before:bg-grade-verified-edge before:align-middle before:content-['']"
                : 'rounded-full border border-degraded-edge bg-degraded-bg px-2 py-0.5 font-medium text-degraded-fg'
            }
          >
            {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
