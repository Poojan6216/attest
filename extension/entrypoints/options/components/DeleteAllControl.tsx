import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import type { SettingResult } from '../../../src/bus/messages';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import { DeleteAllConfirm } from './DeleteAllConfirm';

export interface DeleteAllControlProps {
  /** Asks the service worker to delete everything (`ledger.wipe`). */
  readonly wipe: () => Promise<SettingResult>;
}

type Phase = 'idle' | 'confirming' | 'deleting';
type Outcome = 'none' | 'deleted' | 'failed';

const OUTCOMES: Readonly<Record<Outcome, string>> = {
  none: '',
  deleted: 'Deleted. Attest keeps nothing from before, and reads pages you open from now on.',
  failed: 'Could not delete everything. Try again.',
};

/**
 * Delete all data (sprint_4 4.5): an inline confirm in two more steps (no `window.confirm`), as the install id reset.
 * Focus moves to Cancel when the question opens and back to the start button when it closes, in a layout effect so a
 * fast keyboard user's next key never lands on `<body>`. The result is announced through `role="status"`.
 */
export function DeleteAllControl({ wipe }: DeleteAllControlProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [outcome, setOutcome] = useState<Outcome>('none');
  const startRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<'start' | 'cancel' | null>(null);

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
    setPhase('deleting');
    const settled = wipe().catch((error: unknown) => {
      log.error('options.wipe_failed', { error });
      return { ok: false } as const;
    });
    void settled.then((result) => {
      setOutcome(result.ok ? 'deleted' : 'failed');
      focusTarget.current = 'start';
      setPhase('idle');
    });
  };

  return (
    <div>
      {phase === 'confirming' ? (
        <DeleteAllConfirm onConfirm={confirm} onCancel={cancel} cancelRef={cancelRef} />
      ) : (
        <Button variant="danger-outline" buttonRef={startRef} disabled={phase === 'deleting'} onClick={ask}>
          Delete all data
        </Button>
      )}
      <p role="status" class="mt-2 min-h-5">
        {phase === 'deleting' ? 'Deleting…' : OUTCOMES[outcome]}
      </p>
    </div>
  );
}
