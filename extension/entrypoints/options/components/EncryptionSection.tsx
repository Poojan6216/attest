import { LockedNotice } from '../../../src/ui/LockedNotice';
import { Skeleton } from '../../../src/ui/Skeleton';
import { type CryptoSources, LIVE_CRYPTO, useCryptoStatus } from '../use-crypto-status';
import { CryptoJobLine } from './CryptoJobLine';
import { EncryptionControls } from './EncryptionControls';
import { EncryptionStatement } from './EncryptionStatement';
import { Section } from './Section';
import { TurnOnEncryption } from './TurnOnEncryption';

export interface EncryptionSectionProps {
  /** Where the section reads and sends; the ledger and the bus when absent. */
  readonly sources?: CryptoSources;
}

/**
 * The options page's Encryption (sprint_6 6.5): what it protects; off, the form that turns it on; on and locked, the
 * unlock prompt; on and unlocked, lock now, change the passphrase and turn it off; and while a job rewrites the
 * records, how far it has come.
 */
export function EncryptionSection({ sources = LIVE_CRYPTO }: EncryptionSectionProps) {
  const state = useCryptoStatus(sources);
  const status = state.status === 'ready' ? state.value : undefined;
  return (
    <Section id="encryption">
      <EncryptionStatement />
      {state.status === 'loading' ? <Skeleton rows={1} label="Loading the encryption setting" /> : null}
      {state.status === 'failed' || state.status === 'locked' ? (
        <p role="alert" class="text-error-fg">
          Attest could not read its encryption setting. Reload the page.
        </p>
      ) : null}
      {status?.job === undefined ? null : <CryptoJobLine job={status.job} locked={status.locked} />}
      {status !== undefined && !status.on ? <TurnOnEncryption send={sources.send} /> : null}
      {status?.on === true && status.locked ? (
        <LockedNotice
          toShow="change or turn off encryption"
          unlock={(passphrase) => sources.send({ type: 'crypto.unlock', passphrase })}
        />
      ) : null}
      {status?.on === true && !status.locked && status.job === undefined ? (
        <EncryptionControls send={sources.send} />
      ) : null}
    </Section>
  );
}
