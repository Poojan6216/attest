import type { Grade } from '../ledger/types';
import { gradeLabel } from './receipt-labels';

export interface GradeChipProps {
  readonly grade: Grade;
}

/** Each grade's colours (./tokens.css). OVER SCOPE is an outline only, so it reads apart from NOT FOUND. */
const GRADE_CLASSES: Readonly<Record<Grade, string>> = {
  VERIFIED: 'border border-grade-verified-edge bg-grade-verified-bg text-grade-verified-fg',
  PARTIAL: 'border border-grade-partial-edge bg-grade-partial-bg text-grade-partial-fg',
  NOT_FOUND: 'border border-grade-not-found-edge bg-grade-not-found-bg text-grade-not-found-fg',
  UNASKED: 'border border-grade-unasked-edge bg-grade-unasked-bg text-grade-unasked-fg',
  OVER_SCOPE: 'border-2 border-grade-over-scope-edge bg-transparent text-grade-over-scope-fg',
  UNVERIFIABLE: 'border border-grade-unverifiable-edge bg-grade-unverifiable-bg text-grade-unverifiable-fg',
};

/**
 * A receipt's grade, the headline of every row (agents/ux_engineer.md rule 1): its colour and, always, its name, so
 * colour is never the only signal (rule 10). A screen reader hears "Grade: Not found".
 */
export function GradeChip({ grade }: GradeChipProps) {
  return (
    <span
      class={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-chip py-0.5 text-xs font-semibold ${GRADE_CLASSES[grade]}`}
    >
      <span class="sr-only">Grade: </span>
      {gradeLabel(grade)}
    </span>
  );
}
