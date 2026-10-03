/**
 * Named units for src/core (docs/grading.md §13). Every other core file imports these instead of writing
 * a number; this file is exempt from the core no-literal rule because unit conversions are not policy.
 * Thresholds, windows and weights never live here: they live in policy/default.json.
 */

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const MINUTES_PER_HOUR = 60;

/** Policy weights and thresholds are converted to integer basis points at load (§5.3). */
export const BASIS_POINTS = 10_000;

/** Calendar units for reading vendor-relative times (normalize-relative.ts): "Thu" is at most a week back. */
export const DAYS_PER_WEEK = 7;
/** The Gregorian year: ISO months are 01–12. */
export const MONTHS_PER_YEAR = 12;
/** The 12-hour clock: "2:03 PM" is 14:03, "12:00 AM" is 00:00. */
export const HOURS_PER_HALF_DAY = 12;
/** Positional notation: minor units are major × DECIMAL_RADIX^exponent; ISO fields are zero-padded decimals. */
export const DECIMAL_RADIX = 10;

/**
 * ISO 4217 minor-unit exponents (docs/grading.md §11): "$1.50" is 150 minor units of USD, "¥980" is 980 of JPY,
 * "KWD 1.250" is 1250 of KWD. normalize.amount() reads only currencies listed here; any other code is
 * rejected rather than guessed. A unit table, not policy.
 */
export const CURRENCY_MINOR_UNITS = Object.freeze({
  USD: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  MXN: 2,
  BRL: 2,
  CNY: 2,
  HKD: 2,
  SGD: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
} as const);
