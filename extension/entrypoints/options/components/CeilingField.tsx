import { CURRENCIES, type GrantDraft } from '../../../src/ui/grant-form';

export interface CeilingFieldProps {
  readonly id: string;
  readonly ceiling: string;
  readonly currency: GrantDraft['currency'];
  readonly error: string | undefined;
  readonly onChange: (ceiling: string, currency: GrantDraft['currency']) => void;
}

/** A grant's spend ceiling: a whole number in its currency's main unit (stored in minor units), or blank for none. */
export function CeilingField({ id, ceiling, currency, error, onChange }: CeilingFieldProps) {
  const field =
    'rounded border border-neutral-400 bg-white p-1 text-sm dark:border-neutral-500 dark:bg-neutral-800';
  return (
    <div class="space-y-1">
      <label for={id} class="block text-sm font-medium">
        Spend ceiling
      </label>
      <div class="flex gap-2">
        <input
          id={id}
          inputMode="numeric"
          value={ceiling}
          onInput={(event) => {
            onChange(event.currentTarget.value, currency);
          }}
          aria-describedby={`${id}-hint${error === undefined ? '' : ` ${id}-error`}`}
          aria-invalid={error === undefined ? undefined : true}
          class={`w-32 ${field}`}
        />
        <select
          aria-label="Currency"
          value={currency}
          onChange={(event) => {
            const chosen = CURRENCIES.find((code) => code === event.currentTarget.value);
            if (chosen !== undefined) onChange(ceiling, chosen);
          }}
          class={field}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
      <p id={`${id}-hint`} class="text-xs text-neutral-600 dark:text-neutral-400">
        A whole number, such as 50. Leave it blank for no ceiling.
      </p>
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" class="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
