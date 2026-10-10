import type { ByoStep } from './ByoKeyForm';

/** What went wrong with the person's own key, in one line, for each step that failed. */
const SAID: Readonly<Partial<Record<ByoStep, string>>> = Object.freeze({
  not_a_key:
    'That is not a key as Anthropic or OpenAI write one: letters, digits, - and _, 20 to 300 characters.',
  wrong_vendor:
    'That key is not the chosen company’s: Anthropic’s keys begin sk-ant-, and OpenAI’s begin sk-.',
  failed: 'Not changed. Try again.',
});

/** The line for `step` (header), or nothing while it went well. */
export function ByoAlert({ step }: { readonly step: ByoStep }) {
  const line = SAID[step];
  return line === undefined ? null : (
    <p role="alert" class="text-sm text-error-fg">
      {line}
    </p>
  );
}
