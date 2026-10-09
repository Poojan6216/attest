import { weekLabel } from '../../../src/ui/digest-labels';

export interface WeekPickerProps {
  readonly weeks: readonly string[];
  readonly week: string;
  readonly onChoose: (week: string) => void;
}

/** Which week's digest to read: every week that has one, newest first (sprint_4 4.7). */
export function WeekPicker({ weeks, week, onChoose }: WeekPickerProps) {
  return (
    <label class="flex items-center gap-2">
      <span class="font-medium">Week</span>
      <select
        class="rounded border border-rule bg-surface px-2 py-1"
        value={week}
        onChange={(event) => {
          onChoose(event.currentTarget.value);
        }}
      >
        {weeks.map((each) => (
          <option key={each} value={each}>
            {weekLabel(each)}
          </option>
        ))}
      </select>
    </label>
  );
}
