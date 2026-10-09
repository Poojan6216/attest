import type { AgentWeek, Grade } from '../../../src/ledger/types';
import { GradeChip } from '../../../src/ui/GradeChip';
import { AGENT_NAMES } from '../../../src/ui/paste-labels';

export interface AgentWeekCardProps {
  readonly week: AgentWeek;
}

const GRADES: readonly Grade[] = [
  'VERIFIED',
  'PARTIAL',
  'NOT_FOUND',
  'UNASKED',
  'OVER_SCOPE',
  'UNVERIFIABLE',
];

/**
 * One agent's week (sprint_4 4.7): its final receipts by grade, how many of its checked claims were verified, and how
 * many are still checking or marked by the person. Every number is the digest's own.
 */
export function AgentWeekCard({ week }: AgentWeekCardProps) {
  const graded = GRADES.filter((grade) => week.grades[grade] > 0);
  return (
    <li class="space-y-2 rounded border border-rule p-row">
      <h3 class="font-semibold">{AGENT_NAMES[week.agent]}</h3>
      {graded.length === 0 ? (
        <p>No receipt ended this week.</p>
      ) : (
        <ul class="flex flex-wrap gap-3" aria-label={`${AGENT_NAMES[week.agent]}’s receipts by grade`}>
          {graded.map((grade) => (
            <li key={grade} class="flex items-center gap-1">
              <GradeChip grade={grade} />
              <span>{String(week.grades[grade])}</span>
            </li>
          ))}
        </ul>
      )}
      <p>
        {week.checked === 0
          ? 'No claim could be checked.'
          : `${String(week.verified)} of ${String(week.checked)} checked claims verified.`}
      </p>
      {week.checking > 0 ? <p>{String(week.checking)} still checking.</p> : null}
      {week.marked > 0 ? <p>{String(week.marked)} marked by you.</p> : null}
    </li>
  );
}
