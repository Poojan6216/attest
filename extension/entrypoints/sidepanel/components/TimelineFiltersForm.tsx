import { AgentId, type Grade, Grade as Grades } from '../../../src/core/schema';
import type { TimelineFilters } from '../../../src/ui/data';
import { AGENT_NAMES, UNASKED_LIMIT } from '../../../src/ui/labels';
import { gradeLabel } from '../../../src/ui/receipt-labels';
import { CheckGroup } from '../../../src/ui/CheckGroup';
import { DayRange } from './DayRange';

export interface TimelineFiltersFormProps {
  readonly filters: TimelineFilters;
  readonly onChange: (next: TimelineFilters) => void;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const AGENTS = AgentId.options.map((agent) => [agent, AGENT_NAMES[agent]] as const);
const GRADES = Grades.options.map((grade) => [grade, gradeLabel(grade)] as const);

/** `filters` with every grade: no grade filter at all, so the timeline reads through `[agent+computedMs]`. */
const everyGrade = ({ agents, from, to }: TimelineFilters): TimelineFilters => ({ agents, from, to });

/**
 * The timeline's filters (sprint_4 4.3: agent, grade, date range), combined: the receipts of the agents checked, of
 * the grades checked, graded on the days from and to (both included). A change reads the timeline again from the top.
 * While Unasked is shown, what it cannot catch is said under the grades (sprint_6 6.9: no Unasked receipt is not no
 * unasked action).
 */
export function TimelineFiltersForm({ filters, onChange }: TimelineFiltersFormProps) {
  const shown = filters.grades ?? Grades.options;
  const toggleAgent = (agent: AgentId) => {
    const on = !filters.agents.includes(agent);
    onChange({
      ...filters,
      agents: AgentId.options.filter((each) => (each === agent ? on : filters.agents.includes(each))),
    });
  };
  const toggleGrade = (grade: Grade) => {
    const on = !shown.includes(grade);
    const grades = Grades.options.filter((each) => (each === grade ? on : shown.includes(each)));
    onChange(grades.length === Grades.options.length ? everyGrade(filters) : { ...filters, grades });
  };
  return (
    <section aria-label="Filters" class="space-y-2">
      <CheckGroup
        legend="Agents"
        options={AGENTS}
        checked={(agent) => filters.agents.includes(agent)}
        onToggle={toggleAgent}
      />
      <CheckGroup
        legend="Grades"
        options={GRADES}
        checked={(grade) => shown.includes(grade)}
        onToggle={toggleGrade}
      />
      {shown.includes('UNASKED') ? <p class="text-xs text-ink-muted">{UNASKED_LIMIT}</p> : null}
      <DayRange
        from={filters.from}
        to={filters.to}
        onChange={(key, value) => {
          if (DAY.test(value)) onChange({ ...filters, [key]: value });
        }}
      />
    </section>
  );
}
