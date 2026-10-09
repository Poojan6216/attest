export interface DayRangeProps {
  /** The first and last local days, `YYYY-MM-DD`, both included. */
  readonly from: string;
  readonly to: string;
  readonly onChange: (key: 'from' | 'to', value: string) => void;
}

/** The timeline's date range: From and To, the browser's own date fields. */
export function DayRange({ from, to, onChange }: DayRangeProps) {
  return (
    <div class="flex flex-wrap gap-3">
      {(
        [
          ['from', 'From', from],
          ['to', 'To', to],
        ] as const
      ).map(([key, label, value]) => (
        <label key={key} class="flex items-center gap-1 text-xs text-ink">
          {label}
          <input
            type="date"
            value={value}
            onChange={(event) => {
              onChange(key, event.currentTarget.value);
            }}
            class="rounded border border-rule bg-surface px-1 text-ink"
          />
        </label>
      ))}
    </div>
  );
}
