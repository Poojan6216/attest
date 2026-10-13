/**
 * The options page's Encryption (sprint_6 6.5): where the ledger's encryption stands, read from `meta` (readable while
 * locked) and this page's keyring, read again whenever `meta` changes (a command done, a job's next table) or this
 * page's keys do (src/ui/data.ts `onLedgerChanged`); and the commands, sent to the service worker. A passphrase goes
 * only to Attest's own contexts, the service worker alone acting on it, never into a log.
 */
import { useState } from 'preact/hooks';

import type { CryptoCode, CryptoResult } from '../../src/bus/messages';
import { sendCrypto } from '../../src/bus/send';
import { onRebuildMarkChanged } from '../../src/ledger/rebuild-mark';
import { log } from '../../src/log';
import { onLedgerChanged } from '../../src/ui/data';
import { type CryptoStatus, loadCryptoStatus } from '../../src/ui/settings-data';
import { type LedgerRead, useLedgerRead } from '../../src/ui/use-ledger-read';

export type CryptoCommand = Parameters<typeof sendCrypto>[0];

export interface CryptoSources {
  readonly load: () => Promise<CryptoStatus>;
  readonly send: (command: CryptoCommand) => Promise<CryptoResult>;
  readonly subscribe: (onChange: () => void) => () => void;
}

export const LIVE_CRYPTO: CryptoSources = {
  load: loadCryptoStatus,
  send: sendCrypto,
  subscribe: (onChange) => {
    const stopLedger = onLedgerChanged(['meta'], onChange);
    // A rebuild of the ledger's database starting or ending (Sprint 6 close; src/ledger/rebuild-mark.ts).
    const stopMark = onRebuildMarkChanged(() => {
      onChange();
    });
    return () => {
      stopLedger();
      stopMark();
    };
  },
};

const logReadFailed = (error: unknown): void => {
  log.error('options.crypto_failed', { error });
};

/** Where the ledger's encryption stands (header). */
export function useCryptoStatus(sources: CryptoSources = LIVE_CRYPTO): LedgerRead<CryptoStatus> {
  return useLedgerRead(sources.load, sources.subscribe, logReadFailed);
}

/** Where one command stands: not sent, being sent, done, or refused with a code, or a check of the form's own. */
export type CommandStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'done' }
  | { readonly kind: 'refused'; readonly code: CryptoCode | 'short' | 'differ' | 'unconfirmed' };

/** One form's command: `run` sends it, unless one is under way, and `step` says where it stands. */
export function useCryptoCommand(send: CryptoSources['send']): {
  readonly step: CommandStep;
  readonly run: (command: CryptoCommand) => void;
  readonly refuse: (code: 'short' | 'differ' | 'unconfirmed') => void;
} {
  const [step, setStep] = useState<CommandStep>({ kind: 'idle' });
  return {
    step,
    refuse: (code) => {
      setStep({ kind: 'refused', code });
    },
    run: (command) => {
      if (step.kind === 'sending') return;
      setStep({ kind: 'sending' });
      send(command).then(
        (result) => {
          setStep(result.ok ? { kind: 'done' } : { kind: 'refused', code: result.code });
        },
        (error: unknown) => {
          log.warn('options.crypto_failed', { error });
          setStep({ kind: 'refused', code: 'failed' });
        },
      );
    },
  };
}
