import type { PrivacySources } from './privacy-data';
import { privacyLines } from './privacy-text';
import { usePrivacy } from './use-privacy';

export interface PrivacyLineProps {
  /** Where the choices are read; the ledger and storage when absent. */
  readonly sources?: PrivacySources | undefined;
  readonly class: string;
}

/**
 * What leaves the browser, in one short line (Sprint 5 close, security review SEC-1; ./privacy-text.ts): "Nothing
 * leaves your browser." while both options that send are off, otherwise each one that is on.
 */
export function PrivacyLine({ sources, class: className }: PrivacyLineProps) {
  return <p class={className}>{privacyLines(usePrivacy(sources)).join(' ')}</p>;
}
