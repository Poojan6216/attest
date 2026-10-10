import type { CryptoStatus } from '../../../src/ui/settings-data';

const DOING = {
  seal: 'Sealing your records',
  reseal: 'Sealing your records again under the new passphrase',
  unseal: 'Opening your records for good',
} as const;

export interface CryptoJobLineProps {
  readonly job: NonNullable<CryptoStatus['job']>;
  readonly locked: boolean;
}

/** Where the job rewriting the records stands (sprint_6 6.5): which, and which table of how many. */
export function CryptoJobLine({ job, locked }: CryptoJobLineProps) {
  return (
    <p role="status" class="text-sm">
      {DOING[job.kind]}: table {job.table} of {job.of}.{' '}
      {locked ? 'Unlock to let it finish.' : 'You can keep using Attest meanwhile.'}
    </p>
  );
}
