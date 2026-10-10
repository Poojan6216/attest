/**
 * The person's choices that send something (./privacy-data.ts), read in order and again on each change
 * (./use-ledger-read.ts): for the privacy line (./PrivacyLine.tsx) and the options page's statement. Null until read,
 * and when the read fails (logged, Hard Rule 6): the pages then say what is true whatever was chosen.
 */
import { log } from '../log';
import { LIVE_PRIVACY, type PrivacySources } from './privacy-data';
import type { PrivacyState } from './privacy-text';
import { useLedgerRead } from './use-ledger-read';

const logReadFailed = (error: unknown): void => {
  log.error('privacy.read_failed', { error });
};

/** The choices (header), or null while they are not read. */
export function usePrivacy(sources: PrivacySources = LIVE_PRIVACY): PrivacyState | null {
  const read = useLedgerRead(sources.load, sources.subscribe, logReadFailed);
  return read.status === 'ready' ? read.value : null;
}
