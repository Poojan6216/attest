import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import { ResetConfirm } from './ResetConfirm';

export interface ResetInstallIdControlProps {
  /** Resolves `true` when the id was reset, `false` when it could not be (the caller has logged why). */
  readonly onReset: () => Promise<boolean>;
}

type Phase = 'idle' | 'confirming' | 'resetting';
type Outcome = 'none' | 'reset' | 'failed';
type FocusTarget = 'start' | 'cancel' | null;

const OUTCOME_MESSAGES: Readonly<Record<Outcome, string>> = {
  none: '',
  reset: 'Install id reset. The new id is shown above.',
  failed: 'Could not reset the install id. Try again.',
};

/**
 * Two-step inline confirm (no `window.confirm`). Focus moves to Cancel when the question opens, the safe
 * choice, and back to the start button when it closes. The result is announced through `role="status"`.
 *
 * Focus moves in a layout effect, in the same task as the render that removed the focused button. A
 * plain effect runs after paint, so a fast keyboard user's next key would land on `<body>` and Tab would
 * restart from the top of the page.
 */
export function ResetInstallIdControl({ onReset }: ResetInstallIdControlProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [outcome, setOutcome] = useState<Outcome>('none');
  const startRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<FocusTarget>(null);
  const busy = useRef(false);

  useLayoutEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === 'start') startRef.current?.focus();
    if (target === 'cancel') cancelRef.current?.focus();
  }, [phase]);

  const ask = (): void => {
    setOutcome('none');
    focusTarget.current = 'cancel';
    setPhase('confirming');
  };
  const cancel = (): void => {
    focusTarget.current = 'start';
    setPhase('idle');
  };
  const confirm = (): void => {
    if (busy.current) return;
    busy.current = true;
    setPhase('resetting');
    // `onReset` promises never to reject; if one ever does, show the failure instead of a stuck control.
    const settled = onReset().catch((error: unknown) => {
      log.error('options.install_id_reset_rejected', { error });
      return false;
    });
    void settled.then((ok) => {
      busy.current = false;
      setOutcome(ok ? 'reset' : 'failed');
      focusTarget.current = 'start';
      setPhase('idle');
    });
  };

  return (
    <div>
      {phase === 'idle' ? (
        <Button variant="danger-outline" buttonRef={startRef} onClick={ask}>
          Reset install id
        </Button>
      ) : (
        <ResetConfirm onConfirm={confirm} onCancel={cancel} cancelRef={cancelRef} />
      )}
      <p role="status" class="mt-2 min-h-5">
        {OUTCOME_MESSAGES[outcome]}
      </p>
    </div>
  );
}
