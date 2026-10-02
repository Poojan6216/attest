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

/**
 * Epoch ms of an ISO 8601 timestamp with an offset (`2026-10-06T14:02:00-04:00`, `…Z`), exactly the strings the
 * `IsoTs` schema accepts. Sub-millisecond digits are truncated. Throws `NormalizeError('invalid_iso')` for
 * anything else, including an offset-less string (which would mean "local time": Hard Rule 4).
 */
export function instantMs(iso: string): number {
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
