import type { Coverage } from '../../../src/core/schema';
import { count } from '../../../src/ui/paste-labels';
import { coverageEntryLine } from '../../../src/ui/detail-labels';

export interface CoverageEntriesProps {
  readonly coverage: Coverage;
  readonly nowMs: number;
}

/**
 * Every coverage entry the grading read (sprint_4 4.3: the coverage used), one line each, one tap away: a Calendar
 * grading can read hundreds, so they fold under their count.
 */
export function CoverageEntries({ coverage, nowMs }: CoverageEntriesProps) {
  const lines = coverage.observers.map((entry) => coverageEntryLine(entry, nowMs));
  if (lines.length === 0) return <p class="text-xs text-ink-muted">No source had been checked.</p>;
  return (
    <details class="text-xs">
      <summary class="cursor-pointer text-ink-muted">
        {count(lines.length, 'coverage entry', 'coverage entries')}
      </summary>
      <ul class="mt-1 list-disc space-y-0.5 pl-4 text-ink">
        {lines.map((line, at) => (
          <li key={`${String(at)} ${line}`}>{line}</li>
        ))}
      </ul>
    </details>
  );
}
