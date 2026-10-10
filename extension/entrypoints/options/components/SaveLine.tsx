import type { SaveState } from '../use-grant-draft';

export interface SaveLineProps {
  readonly state: SaveState;
}

/** What a grant's Save did, in words: saved, or why not. Nothing before the first Save. */
export function SaveLine({ state }: SaveLineProps) {
  if (state === 'saved') {
    return (
      <p role="status" class="text-sm text-neutral-700 dark:text-neutral-300">
        Saved. It applies to this agent’s open receipts now, and never changes a final one.
      </p>
    );
  }
  if (state === 'invalid' || state === 'failed') {
    return (
      <p role="alert" class="text-sm text-error-fg">
        {state === 'invalid' ? 'Not saved: fix the fields marked above.' : 'Not saved. Try again.'}
      </p>
    );
  }
  return state === 'saving' ? (
    <p role="status" class="text-sm">
      Saving…
    </p>
  ) : null;
}
