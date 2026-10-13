import type { CryptoSources } from '../use-crypto-status';
import { ChangePassphrase } from './ChangePassphrase';
import { LockNow } from './LockNow';
import { TurnOffEncryption } from './TurnOffEncryption';

/** Encryption on and unlocked, no job under way (sprint_6 6.5): lock now, change the passphrase, or turn it off. */
export function EncryptionControls({ send }: { readonly send: CryptoSources['send'] }) {
  return (
    <div class="space-y-4">
      <div class="space-y-2">
        <p>Encryption is on. Your records are sealed, and unlocked in this browser now.</p>
        <LockNow send={send} />
      </div>
      <ChangePassphrase send={send} />
      <TurnOffEncryption send={send} />
    </div>
  );
}
