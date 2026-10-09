export interface GrantTextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onInput: (value: string) => void;
}

/** One list of a grant, one entry per line, with its hint and, when it does not parse, what to fix (inline). */
export function GrantTextField({ id, label, hint, value, error, onInput }: GrantTextFieldProps) {
  return (
    <div class="space-y-1">
      <label for={id} class="block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onInput={(event) => {
          onInput(event.currentTarget.value);
        }}
        aria-describedby={`${id}-hint${error === undefined ? '' : ` ${id}-error`}`}
        aria-invalid={error === undefined ? undefined : true}
        class="w-full rounded border border-neutral-400 bg-white p-1 text-sm dark:border-neutral-500 dark:bg-neutral-800"
      />
      <p id={`${id}-hint`} class="text-xs text-neutral-600 dark:text-neutral-400">
        {hint}
      </p>
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" class="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
