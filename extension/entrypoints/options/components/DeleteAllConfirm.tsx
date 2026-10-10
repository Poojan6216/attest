import type { Ref } from 'preact';
import { useState } from 'preact/hooks';

import { Button } from '../../../src/ui/Button';

export interface DeleteAllConfirmProps {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Receives focus when the question opens: Cancel is the safe choice. */
  readonly cancelRef: Ref<HTMLButtonElement>;
}

/**
 * The second and third steps of Delete all data (sprint_4 4.5, "double confirm"): what goes, a box the person ticks to
 * say they understand it cannot be undone, and only then Delete everything; or Cancel.
 */
export function DeleteAllConfirm({ onConfirm, onCancel, cancelRef }: DeleteAllConfirmProps) {
  const [understood, setUnderstood] = useState(false);
  return (
    <div
      role="group"
      aria-labelledby="delete-all-question"
      class="space-y-3 rounded-md border border-red-600 px-4 py-3 dark:border-red-500"
    >
      <p id="delete-all-question" class="font-medium">
        Delete every receipt, claim and fact Attest keeps in this browser, its grants and its settings? A
        reader you turned off stays off. This cannot be undone.
      </p>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={understood}
          onChange={() => {
            setUnderstood(!understood);
          }}
        />
        I understand that everything is deleted for good
      </label>
      <div class="flex flex-wrap gap-2">
        <Button variant="danger" disabled={!understood} onClick={onConfirm}>
          Delete everything
        </Button>
        <Button variant="secondary" buttonRef={cancelRef} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
