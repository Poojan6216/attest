export interface CheckGroupProps<T extends string> {
  readonly legend: string;
  /** Each value with its label, in the order shown. */
  readonly options: readonly (readonly [T, string])[];
  readonly checked: (value: T) => boolean;
  readonly onToggle: (value: T) => void;
}

/** A labelled group of checkboxes: the timeline's agent and grade filters, a grant's actions. */
export function CheckGroup<T extends string>({ legend, options, checked, onToggle }: CheckGroupProps<T>) {
  return (
    <fieldset class="flex flex-wrap gap-x-3 gap-y-1">
      <legend class="mb-1 text-xs font-medium text-ink">{legend}</legend>
      {options.map(([value, label]) => (
        <label key={value} class="flex items-center gap-1 text-xs text-ink">
          <input
            type="checkbox"
            checked={checked(value)}
            onChange={() => {
              onToggle(value);
            }}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
