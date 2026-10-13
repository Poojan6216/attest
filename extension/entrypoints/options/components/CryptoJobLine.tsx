import type { CryptoStatus } from '../../../src/ui/settings-data';
import { Button } from '../../../src/ui/Button';
import { type CryptoSources, useCryptoCommand } from '../use-crypto-status';
import { CommandLine } from './CommandLine';

const DOING = {
  seal: 'Sealing your records',
  reseal: 'Sealing your records again under the new passphrase',
  unseal: 'Opening your records for good',
} as const;

/** Why a job stopped (tech review TECH-2), in words. */
const STOPPED = {
  unreadable: 'a record did not open with its key',
  storage: 'Chrome could not write to Attest’s storage',
} as const;

export interface CryptoJobLineProps {
  readonly job: NonNullable<CryptoStatus['job']>;
  readonly locked: boolean;
  /** Sends Try again; the service worker when absent. */
  readonly send: CryptoSources['send'];
}

/**
 * Where the job rewriting the records stands (sprint_6 6.5): which, and which table of how many; and when its last step
 * failed, that it stopped and why, with Try again (tech review TECH-2). The grace alarm also tries it again, a few
 * times; never a progress line that is not true.
 */
export function CryptoJobLine({ job, locked, send }: CryptoJobLineProps) {
  const retry = useCryptoCommand(send);
  if (job.stopped === undefined) {
    return (
      <p role="status" class="text-sm">
        {DOING[job.kind]}: table {job.table} of {job.of}.{' '}
        {locked ? 'Unlock to let it finish.' : 'You can keep using Attest meanwhile.'}
      </p>
    );
  }
  return (
    <div class="space-y-2">
      <p role="alert" class="text-sm text-error-fg">
        {DOING[job.kind]} stopped at table {job.table} of {job.of}: {STOPPED[job.stopped]}.{' '}
        {locked ? 'Unlock to try again.' : 'Attest tries again on its own a few times.'}
      </p>
      {locked ? null : (
        <Button
          variant="secondary"
          disabled={retry.step.kind === 'sending'}
          onClick={() => {
            retry.run({ type: 'crypto.resume' });
          }}
        >
          Try again
        </Button>
      )}
      <CommandLine step={retry.step} done="Trying again." />
    </div>
  );
}
