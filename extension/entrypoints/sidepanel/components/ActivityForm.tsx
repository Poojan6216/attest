import type { RefObject } from 'preact';

import { Button } from '../../../src/ui/Button';
import type { FormStep } from '../use-paste-flow';
import { AgentPicker } from './AgentPicker';

export interface ActivityFormProps {
  readonly form: FormStep;
  readonly onChange: (form: FormStep) => void;
  readonly onPreview: () => void;
  readonly onCancel: () => void;
  readonly agentRef: RefObject<HTMLInputElement>;
  readonly textRef: RefObject<HTMLTextAreaElement>;
}

const HINT_ID = 'paste-log-hint';
const ERROR_ID = 'paste-log-error';

/**
 * The form: whose log, and the log itself. Spell check, autocorrect and autocomplete are off on the paste box: Chrome's
 * enhanced spell check sends typed text to Google, and the log stays in this browser (Hard Rule 1).
 */
export function ActivityForm({ form, onChange, onPreview, onCancel, agentRef, textRef }: ActivityFormProps) {
  return (
    <section aria-labelledby="add-activity-heading" class="space-y-3">
      <h2 id="add-activity-heading" class="text-base font-semibold">
        Add agent activity
      </h2>
      <p>
        Copy what the agent says it did, such as Muse’s activity log, and paste it here. Attest reads it in
        this panel and keeps the actions it finds and the times of the log’s entries, never the text.
      </p>
      <AgentPicker
        value={form.agent}
        firstRef={agentRef}
        onChange={(agent) => {
          onChange({ ...form, agent, error: null });
        }}
      />
      <div>
        <label for="paste-log" class="font-medium">
          Activity log
        </label>
        <p id={HINT_ID} class="text-neutral-600 dark:text-neutral-400">
          Include the day heading, such as “Today”, so Attest knows the day.
        </p>
        <textarea
          id="paste-log"
          ref={textRef}
          rows={8}
          value={form.text}
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
          aria-describedby={form.error === null ? HINT_ID : `${HINT_ID} ${ERROR_ID}`}
          aria-invalid={form.error !== null}
          onInput={(event) => {
            onChange({ ...form, text: event.currentTarget.value, error: null });
          }}
          class="mt-1 w-full rounded-md border border-neutral-400 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-500 dark:bg-neutral-800"
        />
        {form.error !== null && (
          <p id={ERROR_ID} role="alert" class="text-red-800 dark:text-red-300">
            {form.error}
          </p>
        )}
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onPreview}>
          Preview
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
