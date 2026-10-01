import type { Ref } from 'preact';

import { Button } from './Button';

export interface ResetConfirmProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Receives focus when the question opens: Cancel is the safe choice. */
  readonly cancelRef: Ref<HTMLButtonElement>;
}

/** The second step of the install id reset: the question, then Reset id or Cancel. */
export function ResetConfirm({ onConfirm, onCancel, cancelRef }: ResetConfirmProps) {
  return (
    <div
      role="group"
      aria-labelledby="reset-install-id-question"
      class="rounded-md border border-red-600 px-4 py-3 dark:border-red-500"
    >
      <p id="reset-install-id-question" class="font-medium">
        Replace the install id with a new random one? This cannot be undone.
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button variant="danger" onClick={onConfirm}>
          Reset id
        </Button>
        <Button variant="secondary" buttonRef={cancelRef} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
