export interface PassphraseFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onInput: (value: string) => void;
  /** `new-password` for a passphrase being chosen, `current-password` for one being typed. */
  readonly autoComplete: 'new-password' | 'current-password';
}

/** One passphrase, hidden as it is typed (sprint_6 6.5). Never logged, never kept beyond the form. */
export function PassphraseField({ label, value, onInput, autoComplete }: PassphraseFieldProps) {
  return (
    <label class="block text-sm">
      {label}
      <input
        type="password"
        autoComplete={autoComplete}
        spellcheck={false}
        class="mt-1 block w-full rounded border border-rule bg-surface px-2 py-1"
        value={value}
        onInput={(event) => {
          onInput(event.currentTarget.value);
        }}
      />
    </label>
  );
}
