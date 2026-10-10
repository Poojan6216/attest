import { useState } from 'preact/hooks';

import type { CryptoResult } from '../bus/messages';
import { log } from '../log';
import { Button } from './Button';

/** Sends the passphrase to the service worker; the bus loads only now, never at a page's start. */
async function sendUnlock(passphrase: string): Promise<CryptoResult> {
  const { sendCrypto } = await import('../bus/send');
  return sendCrypto({ type: 'crypto.unlock', passphrase });
}

type UnlockStep = 'idle' | 'unlocking' | 'wrong' | 'failed';

const SAID: Readonly<Record<Exclude<UnlockStep, 'idle'>, string>> = {
  unlocking: 'Unlocking…',
  wrong: 'That passphrase does not open your records. Check it and try again.',
  failed: 'Attest could not unlock your records. Try again.',
};

export interface UnlockFormProps {
  /** Sends the unlock; the service worker when absent. */
  readonly unlock?: (passphrase: string) => Promise<CryptoResult>;
}

/**
 * The unlock prompt (sprint_6 6.5): the passphrase of an encrypted ledger, sent to the service worker, which checks
 * it against the ledger's key check before any record is read. Unlocked, the page reads again on its own (src/ui/
 * data.ts `onLedgerChanged`); a wrong passphrase is said, and the records stay locked. The passphrase is never logged.
 */
export function UnlockForm({ unlock = sendUnlock }: UnlockFormProps) {
  const [passphrase, setPassphrase] = useState('');
  const [step, setStep] = useState<UnlockStep>('idle');
  const submit = (event: Event): void => {
    event.preventDefault();
    if (passphrase.length === 0 || step === 'unlocking') return;
    setStep('unlocking');
    unlock(passphrase).then(
      (result) => {
        const opened = result.ok || result.code === 'off';
        if (opened) setPassphrase('');
        setStep(opened ? 'idle' : result.code === 'wrong_passphrase' ? 'wrong' : 'failed');
      },
      (error: unknown) => {
        log.warn('ui.unlock_failed', { error });
        setStep('failed');
      },
    );
  };
  return (
    <form class="space-y-2" onSubmit={submit}>
      <label class="block text-sm">
        Passphrase
        <input
          type="password"
          autoComplete="current-password"
          spellcheck={false}
          required
          class="mt-1 block w-full rounded border border-rule bg-surface px-2 py-1"
          value={passphrase}
          onInput={(event) => {
            setPassphrase(event.currentTarget.value);
          }}
        />
      </label>
      <Button variant="primary" type="submit" disabled={step === 'unlocking'}>
        Unlock
      </Button>
      {step === 'idle' ? null : (
        <p
          role={step === 'unlocking' ? 'status' : 'alert'}
          class={step === 'unlocking' ? '' : 'text-error-fg'}
        >
          {SAID[step]}
        </p>
      )}
    </form>
  );
}
