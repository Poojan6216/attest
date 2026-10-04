/**
 * Typed errors for the Calendar observer (sprint_2 2.5). A `GcalError` carries a closed `code` and a message built
 * from that code only, so an uncaught one never prints page content (Hard Rule 10).
 *
 * A pass never lets one escape as anything but a DEGRADED report: inside `extract()` the skeleton turns a throw
 * into `extract.threw` with no rows and no coverage (src/observers/plan.ts, Hard Rule 6).
 */

export const GCAL_ERROR_CODES = [
  /** `extract()` met a page `health()` would have reported DEGRADED (a different offset function, or a race). */
  'unreadable_page',
  /** Two snapshots of different ranges were diffed: a caller's bug (the store is keyed by range). */
  'range_mismatch',
  /** A snapshot built from the page failed its own schema: a bug in the reader. */
  'invalid_snapshot',
] as const;

export type GcalErrorCode = (typeof GCAL_ERROR_CODES)[number];

export class GcalError extends Error {
  override readonly name = 'GcalError';
  readonly code: GcalErrorCode;

  constructor(code: GcalErrorCode) {
    super(`gcal: ${code}`);
    this.code = code;
  }
}
