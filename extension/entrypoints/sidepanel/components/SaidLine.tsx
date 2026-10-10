import type { Said } from '../use-mark';

export interface SaidLineProps {
  readonly said: Said;
}

/** What the panel says after a change: an error as an alert, a saved change as a status. */
export function SaidLine({ said }: SaidLineProps) {
  if (said === null) return null;
  return said.kind === 'error' ? (
    <p role="alert" class="text-xs text-error-fg">
      {said.text}
    </p>
  ) : (
    <p role="status" class="text-xs text-ink-muted">
      {said.text}
    </p>
  );
}
