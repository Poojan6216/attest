import { useEffect, useState } from 'preact/hooks';

import type { SettingResult } from '../../../src/bus/messages';
import { RETENTION_CHOICES, RETENTION_DAYS } from '../../../src/config';
import type { RetentionChoice } from '../../../src/ledger/settings';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';

export interface RetentionControlProps {
  /** The window in force. */
  readonly stored: RetentionChoice;
  readonly save: (days: RetentionChoice) => Promise<SettingResult>;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const label = (days: RetentionChoice): string =>
  days === RETENTION_DAYS ? `${String(days)} days (the default)` : `${String(days)} days`;

/**
 * How long Attest keeps dated history (sprint_4 4.5): 30, 90 or 180 days, saved explicitly. Receipts and the facts
 * behind them go once older than the window, at the daily clean-up; the line under Save says what was saved.
 */
export function RetentionControl({ stored, save }: RetentionControlProps) {
  const [chosen, setChosen] = useState<RetentionChoice>(stored);
  const [state, setState] = useState<SaveState>('idle');
  useEffect(() => {
    setChosen(stored);
  }, [stored]);
  const submit = (): void => {
    setState('saving');
    const days = chosen;
    save(days).then(
      (result) => {
        setState(result.ok ? 'saved' : 'failed');
      },
      (error: unknown) => {
        log.warn('options.retention_save_failed', { error });
        setState('failed');
      },
    );
  };
  return (
    <fieldset class="space-y-2">
      <legend class="font-semibold">Keep history for</legend>
      <p class="text-sm">
        Attest deletes receipts, and the facts behind them, once they are older than this. It checks once a
        day.
      </p>
      <div class="flex flex-wrap gap-4">
        {RETENTION_CHOICES.map((days) => (
          <label key={days} class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="retention"
              value={String(days)}
              checked={chosen === days}
              onChange={() => {
                setChosen(days);
                setState('idle');
              }}
            />
            {label(days)}
          </label>
        ))}
      </div>
      <Button variant="secondary" disabled={state === 'saving' || chosen === stored} onClick={submit}>
        Save retention
      </Button>
      {state === 'failed' ? (
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">
          Not saved. Try again.
        </p>
      ) : (
        <p role="status" class="min-h-5 text-sm">
          {state === 'saving' ? 'Saving…' : ''}
          {state === 'saved' ? `Saved. Attest keeps ${String(stored)} days of history.` : ''}
        </p>
      )}
    </fieldset>
  );
}
