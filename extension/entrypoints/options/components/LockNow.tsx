import { Button } from '../../../src/ui/Button';
import { type CryptoSources, useCryptoCommand } from '../use-crypto-status';
import { CommandLine } from './CommandLine';

/**
 * Lock now (sprint_6 6.5): every page forgets the keys at once. Shown whenever the ledger is unlocked, a job under way
 * included, since the service worker takes it then too (tech review TECH-2).
 */
export function LockNow({ send }: { readonly send: CryptoSources['send'] }) {
  const lock = useCryptoCommand(send);
  return (
    <div class="space-y-2">
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
  );
}
