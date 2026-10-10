import { PRIVACY_DOC_URL } from '../../../src/config';
import type { PrivacySources } from '../../../src/ui/privacy-data';
import { privacyLines } from '../../../src/ui/privacy-text';
import { usePrivacy } from '../../../src/ui/use-privacy';

export interface PrivacyStatementProps {
  /** Where the person's choices are read; the ledger and storage when absent. */
  readonly privacy?: PrivacySources;
}

/**
 * The first line of the options page (ux_engineer rule 8), with a link to the privacy architecture: what leaves the
 * browser now (Sprint 5 close, security review SEC-1; src/ui/privacy-text.ts), what Attest reads and keeps, and the two
 * options that send something, both off until the person turns them on.
 */
export function PrivacyStatement({ privacy }: PrivacyStatementProps) {
  const lines = privacyLines(usePrivacy(privacy));
  return (
    <div class="rounded-lg border border-neutral-300 bg-white px-5 py-4 dark:border-neutral-700 dark:bg-neutral-900">
      <p class="text-base font-semibold">{lines.join(' ')}</p>
      <p class="mt-1 text-neutral-700 dark:text-neutral-300">
        Attest reads only pages you have open and keeps what it finds in this browser. Only two options send
        anything, and both are off until you turn them on: your own model key, under Model, and anonymous
        usage numbers, under Privacy.{' '}
        <a href={PRIVACY_DOC_URL} target="_blank" rel="noopener noreferrer" class="underline">
          Read how<span class="sr-only"> Attest keeps your data private (opens a new tab)</span>
        </a>
      </p>
    </div>
  );
}
