import { Button } from '../../../src/ui/Button';
import { type CryptoSources, useCryptoCommand } from '../use-crypto-status';
import { ChangePassphrase } from './ChangePassphrase';
import { CommandLine } from './CommandLine';
import { TurnOffEncryption } from './TurnOffEncryption';

/** Encryption on and unlocked (sprint_6 6.5): lock now, change the passphrase, or turn it off. */
export function EncryptionControls({ send }: { readonly send: CryptoSources['send'] }) {
  const lock = useCryptoCommand(send);
  return (
    <div class="space-y-4">
      <div class="space-y-2">
        <p>Encryption is on. Your records are sealed, and unlocked in this browser now.</p>
        <Button
          variant="secondary"
          disabled={lock.step.kind === 'sending'}
          onClick={() => {
            lock.run({ type: 'crypto.lock' });
          }}
        >
          Lock now
        </Button>
        <CommandLine step={lock.step} done="Locked." />
      </div>
      <ChangePassphrase send={send} />
      <TurnOffEncryption send={send} />
    </div>
  );
}
