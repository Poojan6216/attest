/**
 * What the pages say leaves the browser (Sprint 5 close, security review SEC-1; Hard Rule 1; PRIVACY.md "What leaves
 * your browser"). Nothing, while both options that send are off; otherwise each one that is on, and what it sends where.
 * Until the person's choices are read, the sentence that is true whatever they are.
 */
import { BYO_VENDORS, type ByoVendor } from '../config';

/** The person's choices that send something. */
export interface PrivacyState {
  /** The vendor of the person's own key while it is on and a key is saved; null otherwise. */
  readonly byo: ByoVendor | null;
  /** Whether the anonymous usage numbers are on. */
  readonly telemetry: boolean;
}

/** True whatever the person chose: said until the choices are read, and when they cannot be. */
export const PRIVACY_UNKNOWN = 'Nothing leaves your browser unless you turn on an option that sends.';

/** Said while both options that send are off. */
export const PRIVACY_NOTHING = 'Nothing leaves your browser.';

/** The lines to show for `state` (header); `null` while it is unknown. */
export function privacyLines(state: PrivacyState | null): string[] {
  if (state === null) return [PRIVACY_UNKNOWN];
  const lines: string[] = [];
  if (state.byo !== null)
    lines.push(`Your own model key is on: facts of partial matches go to ${BYO_VENDORS[state.byo].label}.`);
  if (state.telemetry) lines.push('Usage numbers are on: counts go to Attest’s server once a day.');
  return lines.length === 0 ? [PRIVACY_NOTHING] : lines;
}
