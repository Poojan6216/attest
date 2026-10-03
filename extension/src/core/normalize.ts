/**
 * Normalisation (docs/grading.md §11; module contract §13): the one place claims and observations are put into
 * comparable form. Pure: no clock, no time-zone database, no locale, no I/O (Hard Rule 4).
 *
 *  - Addresses (normalize-text.ts): kept exactly as read, flagged `confusable` from the raw form, compared by
 *    code point after ASCII-only lowercasing. Never NFKC/NFC-normalised.
 *  - Names and subjects (normalize-text.ts): folded into tokens.
 *  - Amounts (normalize-amount.ts): integer minor units + ISO currency, or null when ambiguous.
 *  - Times (normalize-time.ts, normalize-relative.ts): ISO-with-offset instants, and vendor-relative text
 *    resolved against a reference instant and an injected UTC-offset function.
 *  - IDN display (punycode.ts): decoding `xn--` labels for display only.
 *  - Unicode (unicode-baseline.ts): every reader uses Unicode 15.0's character properties, and the engine's
 *    normalisation and case mapping never see a newer code point, so the answer is the same on every engine.
 *
 * Split across files to keep each one small; import from here.
 */
export {
  type AddressComparison,
  asciiLower,
  type Counterparty,
  counterparty,
  email,
  type EmailAddress,
  name,
  nameTokens,
  sameAddress,
  stopWordKey,
  stripInvisible,
  subjectTokens,
} from './normalize-text';
export {
  amount,
  type AmountOptions,
  type CurrencyCode,
  isCurrencyCode,
  type Money,
} from './normalize-amount';
export {
  instantMs,
  isoWithOffset,
  NormalizeError,
  type NormalizeErrorCode,
  type OffsetAt,
} from './normalize-time';
export {
  type RelativeContext,
  resolveRelative,
  type ResolvedTime,
  type TimePrecision,
} from './normalize-relative';
export { decodeLabel, decodePunycode, isAceLabel, PunycodeError, toUnicodeDomain } from './punycode';
