/**
 * Typed errors for the Gmail receipt parsers. A `ReceiptError` carries a closed `code` and a message built from that
 * code only, so an uncaught one never prints page content (Hard Rule 10).
 *
 *  - `invalid_selectors`: ./selectors.json does not parse (a developer error, thrown when the module loads, before
 *    any page is read).
 *  - `time_unresolved`: a message a parser claimed as a receipt has a date that does not name one minute (no date
 *    text, or a clock time a DST change makes ambiguous). `extract()` throws it, so the pass is DEGRADED
 *    (`extract.threw`) and no row is guessed (Hard Rules 5, 6).
 */

export const RECEIPT_ERROR_CODES = ['invalid_selectors', 'time_unresolved'] as const;

export type ReceiptErrorCode = (typeof RECEIPT_ERROR_CODES)[number];

export class ReceiptError extends Error {
  override readonly name = 'ReceiptError';
  readonly code: ReceiptErrorCode;

  constructor(code: ReceiptErrorCode) {
    super(`gmail.receipt: ${code}`);
    this.code = code;
  }
}
