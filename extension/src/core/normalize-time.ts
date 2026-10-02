/**
 * Instants and wall clocks (docs/grading.md §11). Pure: no clock, no time-zone database, no local-time `Date`
 * methods. `Date` is used only as a proleptic-Gregorian calculator over UTC fields.
 *
 * Time zones enter only as an injected `OffsetAt` function (epoch ms → UTC offset in minutes at that instant).
 * Converting a local wall time to an instant (`wallToInstant`) asks it for the offsets around the wall time:
 *  - exactly one instant shows that wall time → that instant (`exact: true`);
 *  - two do (the repeated hour when clocks go back) → the earlier one, `exact: false`;
 *  - none do (the skipped hour when clocks go forward) → read with the offset in force before the gap, i.e.
 *    shifted forward by the gap (2:30 AM on a spring-forward day is 3:30 AM), `exact: false`.
 * This is RFC 5545 / Temporal "compatible" disambiguation. Callers that need a single instant must treat
 * `exact: false` as "this text does not name one instant" (resolveRelative widens to the day).
 */
import {
  DECIMAL_RADIX,
  MINUTES_PER_HOUR,
  MONTHS_PER_YEAR,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from './units';

/** UTC offset in minutes (e.g. -240 for New York in summer) in force at `epochMs`. Injected; never read by core. */
export type OffsetAt = (epochMs: number) => number;

export type NormalizeErrorCode = 'invalid_iso' | 'invalid_instant' | 'invalid_offset';

export class NormalizeError extends Error {
  constructor(readonly code: NormalizeErrorCode) {
    super(`normalize: ${code}`);
    this.name = 'NormalizeError';
  }
}

const MINUTES_PER_DAY = MS_PER_DAY / MS_PER_MINUTE;
const SECONDS_PER_MINUTE = MS_PER_MINUTE / MS_PER_SECOND;
export const HOURS_PER_DAY = MS_PER_DAY / MS_PER_HOUR;

/**
 * The shape `z.iso.datetime({ offset: true })` accepts (schema `IsoTs`): seconds required, any number of
 * fraction digits, `Z` or `±hh:mm`. Field ranges and calendar validity are checked by round trip below.
 */
const ISO_WITH_OFFSET =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d+))?(?:Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/;
const FOUR_DIGIT_YEAR = /^\d{4}-/;
const WHOLE_SECOND = /\.000$/;

export interface CivilDate {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

/** Rejects offsets the ISO schema cannot write (|offset| ≥ 24 h) and non-integer offsets. */
export function checkOffset(offsetMinutes: number): number {
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) >= MINUTES_PER_DAY) {
    throw new NormalizeError('invalid_offset');
  }
  return offsetMinutes;
}

/** `offsetAt(epochMs)`, validated: a broken injected time-zone function fails loudly (Hard Rule 6). */
export function offsetAtChecked(offsetAt: OffsetAt, epochMs: number): number {
  return checkOffset(offsetAt(epochMs));
}

/** Epoch ms of a UTC calendar date at a minute of the day, or null if the date does not exist. */
export function wallClockMs(date: CivilDate, minuteOfDay: number): number | null {
  const calculator = new Date(0);
  calculator.setUTCFullYear(date.year, date.month - 1, date.day);
  const exists =
    calculator.getUTCFullYear() === date.year &&
    calculator.getUTCMonth() === date.month - 1 &&
    calculator.getUTCDate() === date.day;
  return exists ? calculator.getTime() + minuteOfDay * MS_PER_MINUTE : null;
}

function civilDateOfUtc(epochMs: number): CivilDate | null {
  const calculator = new Date(epochMs);
  if (Number.isNaN(calculator.getTime())) return null;
  return {
    year: calculator.getUTCFullYear(),
    month: calculator.getUTCMonth() + 1,
    day: calculator.getUTCDate(),
  };
}

/** The local calendar date at `epochMs` under `offsetMinutes`. */
export function civilDateAt(epochMs: number, offsetMinutes: number): CivilDate | null {
  return civilDateOfUtc(epochMs + offsetMinutes * MS_PER_MINUTE);
}

/** `date` moved by whole days (negative = earlier); null outside the representable range. */
export function addDays(date: CivilDate, days: number): CivilDate | null {
  const midnight = wallClockMs(date, 0);
  return midnight === null ? null : civilDateOfUtc(midnight + days * MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday, for a valid date. */
export function weekdayOf(date: CivilDate): number | null {
  const midnight = wallClockMs(date, 0);
  return midnight === null ? null : new Date(midnight).getUTCDay();
}

/** Negative, zero or positive as `a` is before, on or after `b`. */
export function compareDates(a: CivilDate, b: CivilDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

function digitsToMs(fraction: string): number {
  return Number(
    (BigInt(fraction) * BigInt(MS_PER_SECOND)) / BigInt(DECIMAL_RADIX) ** BigInt(fraction.length),
  );
}

function utcFieldsMs(fields: Readonly<Record<string, string | undefined>>): number | null {
  const date = { year: Number(fields.year), month: Number(fields.month), day: Number(fields.day) };
  const [hour, minute, second] = [Number(fields.hour), Number(fields.minute), Number(fields.second)];
  if (hour >= HOURS_PER_DAY || minute >= MINUTES_PER_HOUR || second >= SECONDS_PER_MINUTE) return null;
  const midnight = wallClockMs(date, 0);
  if (midnight === null) return null;
  return midnight + hour * MS_PER_HOUR + minute * MS_PER_MINUTE + second * MS_PER_SECOND;
}

function offsetFieldMinutes(fields: Readonly<Record<string, string | undefined>>): number | null {
  if (fields.sign === undefined) return 0;
  const hours = Number(fields.offsetHour);
  const minutes = Number(fields.offsetMinute);
  if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR) return null;
  const magnitude = hours * MINUTES_PER_HOUR + minutes;
  return fields.sign === '-' ? -magnitude : magnitude;
}

// ── Fast path ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Module-local copies of the units the fast path reads on every call: tests and the bench load core through a
 * module transform that turns each read of an imported binding into a getter call.
 */
const RADIX = DECIMAL_RADIX;
const [MS_SECOND, MS_MINUTE, MS_HOUR] = [MS_PER_SECOND, MS_PER_MINUTE, MS_PER_HOUR];
const [MONTHS, MINUTES, HOURS, SECONDS] = [
  MONTHS_PER_YEAR,
  MINUTES_PER_HOUR,
  HOURS_PER_DAY,
  SECONDS_PER_MINUTE,
];

/** The fixed head of every IsoTs: each letter is one decimal digit of its field, every other character literal. */
const HEAD = 'YYYY-MM-DDThh:mm:ss';
const FIELD_LETTERS = 'YMDhms';
const [YEAR_AT, MONTH_AT, DAY_AT, HOUR_AT, MINUTE_AT, SECOND_AT] = Array.from(FIELD_LETTERS, (letter) =>
  HEAD.indexOf(letter),
);
const YEAR_DIGITS = 'YYYY'.length;
const FIELD_DIGITS = 'MM'.length;
/** The head's literal characters: their positions and code units. */
const LITERAL_AT = Int32Array.from(
  Array.from(HEAD, (character, i) => (FIELD_LETTERS.includes(character) ? -1 : i)).filter((i) => i >= 0),
);
const LITERAL_UNIT = Int32Array.from(LITERAL_AT, (i) => HEAD.charCodeAt(i));
/** The offset `±hh:mm`: where its hour digits, its colon and its minute digits are, from the sign. */
const OFFSET = '±hh:mm';
const [OFFSET_HOUR_AT, OFFSET_COLON_AT, OFFSET_MINUTE_AT] = ['h', ':', 'm'].map((part) =>
  OFFSET.indexOf(part),
);
const ZERO_UNIT = '0'.charCodeAt(0);
const DOT = '.'.charCodeAt(0);
const ZULU = 'Z'.charCodeAt(0);
const PLUS = '+'.charCodeAt(0);
const MINUS = '-'.charCodeAt(0);
const COLON = ':'.charCodeAt(0);
/** Fraction digits that make whole milliseconds (`.sss`); later digits are truncated. */
const MS_DIGITS = String(MS_PER_SECOND).length - 1;
/** `Date.UTC` reads a year below 100 as 1900 + year; such years take the general path. */
const FIRST_FULL_YEAR = DECIMAL_RADIX * DECIMAL_RADIX;

/** The decimal number written by `count` digits from `text[at]`, or -1 when one of them is not a digit. */
function digits(text: string, at: number | undefined, count: number): number {
  const from = at ?? 0;
  let value = 0;
  for (let i = from; i < from + count; i += 1) {
    const digit = text.charCodeAt(i) - ZERO_UNIT;
    if (!(digit >= 0 && digit < RADIX)) return -1;
    value = value * RADIX + digit;
  }
  return value;
}

/** Whether every literal character of the head is where it belongs. */
function headLiterals(iso: string): boolean {
  for (let i = 0; i < LITERAL_AT.length; i += 1) {
    if (iso.charCodeAt(LITERAL_AT[i] ?? 0) !== LITERAL_UNIT[i]) return false;
  }
  return true;
}

/** Where the run of digits from `from` ends. */
function digitsEnd(iso: string, from: number): number {
  let end = from;
  while (digits(iso, end, 1) >= 0) end += 1;
  return end;
}

/** Whole ms of the fraction digits `iso[from, end)`: the first MS_DIGITS, zero-padded, later ones truncated. */
function fractionMs(iso: string, from: number, end: number): number {
  const read = Math.min(end - from, MS_DIGITS);
  let ms = digits(iso, from, read);
  for (let place = read; place < MS_DIGITS; place += 1) ms *= RADIX;
  return ms;
}

/** The offset that ends `iso` from `from` (`Z` or `±hh:mm`, in range) in minutes; null for anything else. */
function readOffset(iso: string, from: number): number | null {
  const sign = iso.charCodeAt(from);
  if (sign === ZULU) return from + 1 === iso.length ? 0 : null;
  if ((sign !== PLUS && sign !== MINUS) || from + OFFSET.length !== iso.length) return null;
  if (iso.charCodeAt(from + (OFFSET_COLON_AT ?? 0)) !== COLON) return null;
  const hours = digits(iso, from + (OFFSET_HOUR_AT ?? 0), FIELD_DIGITS);
  const minutes = digits(iso, from + (OFFSET_MINUTE_AT ?? 0), FIELD_DIGITS);
  if (hours < 0 || minutes < 0 || hours >= HOURS || minutes >= MINUTES) return null;
  const magnitude = hours * MINUTES + minutes;
  return sign === MINUS ? -magnitude : magnitude;
}

/**
 * The UTC offset written at the end of `iso` in minutes, when it ends plainly with `Z` (0) or with an in-range
 * `±hh:mm`; null for anything else (callers then read it their own way). A character-code read, no pattern.
 */
export function trailingOffsetMinutes(iso: string): number | null {
  if (iso.charCodeAt(iso.length - 1) === ZULU) return 0;
  const from = iso.length - OFFSET.length;
  const sign = iso.charCodeAt(from);
  return sign === PLUS || sign === MINUS ? readOffset(iso, from) : null;
}

/**
 * `instantMs` for the common shape, by character codes and integer arithmetic, or null whenever the text is not
 * plainly that shape (the general path then decides, so the two never disagree on anything this accepts; a
 * property test pins them together): the head, an optional fraction, `Z` or `±hh:mm`, every field in range, the
 * day in its month, a year from 0100.
 */
function fastInstantMs(iso: string): number | null {
  if (iso.length <= HEAD.length || !headLiterals(iso)) return null;
  const year = digits(iso, YEAR_AT, YEAR_DIGITS);
  const month = digits(iso, MONTH_AT, FIELD_DIGITS);
  const day = digits(iso, DAY_AT, FIELD_DIGITS);
  const hour = digits(iso, HOUR_AT, FIELD_DIGITS);
  const minute = digits(iso, MINUTE_AT, FIELD_DIGITS);
  const second = digits(iso, SECOND_AT, FIELD_DIGITS);
  if (year < FIRST_FULL_YEAR || month < 1 || month > MONTHS || day < 1) return null;
  if (hour < 0 || minute < 0 || second < 0 || hour >= HOURS || minute >= MINUTES || second >= SECONDS)
    return null;
  const dotted = iso.charCodeAt(HEAD.length) === DOT;
  const end = dotted ? digitsEnd(iso, HEAD.length + 1) : HEAD.length;
  if (dotted && end === HEAD.length + 1) return null;
  const offset = readOffset(iso, end);
  if (offset === null) return null;
  const midnight = Date.UTC(year, month - 1, day);
  if (midnight >= Date.UTC(year, month, 1)) return null;
  const fraction = dotted ? fractionMs(iso, HEAD.length + 1, end) : 0;
  const utc = midnight + hour * MS_HOUR + minute * MS_MINUTE + second * MS_SECOND;
  return utc + fraction - offset * MS_MINUTE;
}

/**
 * Epoch ms of an ISO 8601 timestamp with an offset (`2026-10-06T14:02:00-04:00`, `…Z`), exactly the strings the
 * `IsoTs` schema accepts. Sub-millisecond digits are truncated. Throws `NormalizeError('invalid_iso')` for
 * anything else, including an offset-less string (which would mean "local time": Hard Rule 4).
 */
export function instantMs(iso: string): number {
  return fastInstantMs(iso) ?? generalInstantMs(iso);
}

/** `instantMs` by the schema's own pattern: every string the fast path leaves to it. */
function generalInstantMs(iso: string): number {
  const fields = ISO_WITH_OFFSET.exec(iso)?.groups;
  if (fields === undefined) throw new NormalizeError('invalid_iso');
  const utc = utcFieldsMs(fields);
  const offset = offsetFieldMinutes(fields);
  if (utc === null || offset === null) throw new NormalizeError('invalid_iso');
  const fraction = fields.fraction === undefined ? 0 : digitsToMs(fields.fraction);
  return utc + fraction - offset * MS_PER_MINUTE;
}

function twoDigits(value: number): string {
  return value < DECIMAL_RADIX ? `0${value}` : `${value}`;
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  const hours = Math.floor(magnitude / MINUTES_PER_HOUR);
  return `${sign}${twoDigits(hours)}:${twoDigits(magnitude % MINUTES_PER_HOUR)}`;
}

/**
 * `epochMs` written in local time at `offsetMinutes` with an explicit `±hh:mm` offset (never `Z`, never the
 * host's zone): `YYYY-MM-DDTHH:mm:ss±hh:mm`, plus `.sss` only when the milliseconds are not zero.
 * `instantMs(isoWithOffset(t, o)) === t`. Throws `NormalizeError` for a non-integer instant, an offset of
 * 24 h or more, or a local year outside 0000–9999.
 */
export function isoWithOffset(epochMs: number, offsetMinutes: number): string {
  checkOffset(offsetMinutes);
  if (!Number.isInteger(epochMs)) throw new NormalizeError('invalid_instant');
  const local = new Date(epochMs + offsetMinutes * MS_PER_MINUTE);
  if (Number.isNaN(local.getTime())) throw new NormalizeError('invalid_instant');
  const utcText = local.toISOString();
  if (!FOUR_DIGIT_YEAR.test(utcText)) throw new NormalizeError('invalid_instant');
  return `${utcText.slice(0, -1).replace(WHOLE_SECOND, '')}${formatOffset(offsetMinutes)}`;
}

export interface WallInstant {
  readonly epochMs: number;
  /** False when the wall time occurred twice (the earlier is returned) or never (shifted past the gap). */
  readonly exact: boolean;
}

/**
 * The instant at which local wall time `wallMs` (epoch ms of the wall time read as if it were UTC) is shown,
 * per the module rule above. Assumes at most one offset change within a day of the wall time.
 */
export function wallToInstant(wallMs: number, offsetAt: OffsetAt): WallInstant {
  const before = offsetAtChecked(offsetAt, wallMs - MS_PER_DAY);
  const after = offsetAtChecked(offsetAt, wallMs + MS_PER_DAY);
  const offsets = new Set([
    before,
    after,
    offsetAtChecked(offsetAt, wallMs - before * MS_PER_MINUTE),
    offsetAtChecked(offsetAt, wallMs - after * MS_PER_MINUTE),
  ]);
  // Distinct offsets give distinct instants, so each valid instant appears once.
  const instants = [...offsets]
    .filter((offset) => offsetAtChecked(offsetAt, wallMs - offset * MS_PER_MINUTE) === offset)
    .map((offset) => wallMs - offset * MS_PER_MINUTE);
  if (instants.length === 0) return { epochMs: wallMs - before * MS_PER_MINUTE, exact: false };
  return { epochMs: Math.min(...instants), exact: instants.length === 1 };
}
