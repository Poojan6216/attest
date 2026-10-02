/**
 * Vendor-relative times → `{ iso, precision }` (docs/grading.md §11, §4.1). Pure; English vendor text only.
 *
 * The reference instant is data (`referenceIso`, normally when the page was read) and the user's time zone is an
 * injected `offsetAt` function; core never reads a clock or a time-zone database (Hard Rule 4). The result's
 * precision is the claim unit of §4.1: the window is the whole minute, hour or day (in the result's own offset)
 * containing `iso`, so a precision is only ever claimed when that unit really contains the text's meaning.
 *
 * Rules (each one returns null rather than guess, Hard Rule 5):
 *  - "2:03 PM", "14:03": today's date if that instant is not more than one displayed minute after the
 *    reference (clock skew), else yesterday's ("11:58 PM" read at 00:30 is last night). Minute precision.
 *  - "Today", "Yesterday", optionally with a clock ("Yesterday, 2:03 PM", "Yesterday at 14:03").
 *  - Weekday names ("Thu", "Thursday"): the most recent such day strictly before today (1–7 days back).
 *    Day precision. With an explicit date ("Thu, Oct 1, 2026") the weekday must agree.
 *  - "Oct 1", "1 Oct", "October 1": the latest such date not after the reference date; with a year
 *    ("Oct 1, 2026", "1 Oct 2026") exactly that date. Day precision, or minute with a clock.
 *  - "5 min ago", "2 hours ago": at least N and under N+1 units elapsed, so the instant lies in
 *    [ref − (N+1)·unit, ref − N·unit]; the result is the start of that range at the finest precision whose
 *    aligned unit contains all of it (usually the next unit up), or null if not even a day does.
 *    "3 days ago" is calendar days (the date three days before today), like "Yesterday" = "1 day ago".
 *  - A clock time that occurs twice or never on that date (a DST change, see normalize-time.ts) does not name
 *    one instant: it resolves to its date at day precision.
 *  - Text that reads differently from how it displays (a bidi override: "\u202E00:21" shows as "12:00"; a
 *    superscript digit: "5² min ago" is not "52 min ago") is not read.
 */
import { readsDifferently, stripInvisible } from './normalize-text';
import {
  addDays,
  type CivilDate,
  civilDateAt,
  compareDates,
  HOURS_PER_DAY,
  instantMs,
  isoWithOffset,
  NormalizeError,
  type OffsetAt,
  offsetAtChecked,
  wallClockMs,
  wallToInstant,
  weekdayOf,
} from './normalize-time';
import {
  DAYS_PER_WEEK,
  HOURS_PER_HALF_DAY,
  MINUTES_PER_HOUR,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
} from './units';

/** Same values as schema `ClaimPrecision`. */
export type TimePrecision = 'minute' | 'hour' | 'day';

export interface ResolvedTime {
  readonly iso: string;
  readonly precision: TimePrecision;
}

export interface RelativeContext {
  /** ISO 8601 with offset: the instant the text was read. */
  readonly referenceIso: string;
  /** The user's UTC offset in minutes at an instant. Injected (the extension reads it from the browser). */
  readonly offsetAt: OffsetAt;
}

interface Frame {
  readonly referenceMs: number;
  readonly today: CivilDate;
  readonly offsetAt: OffsetAt;
}

const PRECISIONS: readonly TimePrecision[] = ['minute', 'hour', 'day'];
const UNIT_MS: Readonly<Record<TimePrecision, number>> = {
  minute: MS_PER_MINUTE,
  hour: MS_PER_HOUR,
  day: MS_PER_DAY,
};
/** A clock shown to the minute may be up to one displayed minute ahead of the reference (vendor/reader skew). */
const DISPLAY_SKEW_MS = MS_PER_MINUTE;

const WEEKDAY_NAMES: readonly (readonly string[])[] = [
  ['sun', 'sunday'],
  ['mon', 'monday'],
  ['tue', 'tues', 'tuesday'],
  ['wed', 'weds', 'wednesday'],
  ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
];
const MONTH_NAMES: readonly (readonly string[])[] = [
  ['jan', 'january'],
  ['feb', 'february'],
  ['mar', 'march'],
  ['apr', 'april'],
  ['may'],
  ['jun', 'june'],
  ['jul', 'july'],
  ['aug', 'august'],
  ['sep', 'sept', 'september'],
  ['oct', 'october'],
  ['nov', 'november'],
  ['dec', 'december'],
];
const AGO_UNITS: ReadonlyMap<string, TimePrecision> = new Map([
  ...['m', 'min', 'mins', 'minute', 'minutes'].map((unit): [string, TimePrecision] => [unit, 'minute']),
  ...['h', 'hr', 'hrs', 'hour', 'hours'].map((unit): [string, TimePrecision] => [unit, 'hour']),
  ...['d', 'day', 'days'].map((unit): [string, TimePrecision] => [unit, 'day']),
]);
const ONE: ReadonlySet<string> = new Set(['a', 'an', 'one']);

const MERIDIEM_WITH_DOTS = /(?<![a-z])([ap])\.m\.?(?![a-z])/g;
const WHITESPACE_RUN = /\s+/gu;
const AGO = /^(?<count>\d+|an?|one)\s*(?<unit>[a-z]+)\.?\s+ago$/;
const CLOCK_AT_END =
  /^(?:(?<date>.*?)[\s,]+(?:at\s+)?)?(?<hour>\d{1,2}):(?<minute>\d{2})\s*(?<meridiem>am|pm)?$/;
const WEEKDAY_FIRST = /^(?<weekday>[a-z]+)\.?(?:,?\s+(?<rest>.+))?$/;
const MONTH_FIRST = /^(?<month>[a-z]+)\.?\s+(?<day>\d{1,2})(?:,?\s+(?<year>\d{4}))?$/;
const DAY_FIRST = /^(?<day>\d{1,2})\s+(?<month>[a-z]+)\.?(?:,?\s+(?<year>\d{4}))?$/;

function cleanText(text: string): string {
  return stripInvisible(stripInvisible(text).normalize('NFKC'))
    .toLowerCase()
    .replace(MERIDIEM_WITH_DOTS, '$1m')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

function resolved(epochMs: number, precision: TimePrecision, frame: Frame): ResolvedTime {
  return { iso: isoWithOffset(epochMs, offsetAtChecked(frame.offsetAt, epochMs)), precision };
}

function startOfDay(date: CivilDate, frame: Frame): ResolvedTime | null {
  const wall = wallClockMs(date, 0);
  return wall === null ? null : resolved(wallToInstant(wall, frame.offsetAt).epochMs, 'day', frame);
}

function atClock(date: CivilDate, minuteOfDay: number, frame: Frame): ResolvedTime | null {
  const wall = wallClockMs(date, minuteOfDay);
  if (wall === null) return null;
  const instant = wallToInstant(wall, frame.offsetAt);
  return instant.exact ? resolved(instant.epochMs, 'minute', frame) : startOfDay(date, frame);
}

function clockOnly(minuteOfDay: number, frame: Frame): ResolvedTime | null {
  const todayWall = wallClockMs(frame.today, minuteOfDay);
  const yesterday = addDays(frame.today, -1);
  if (todayWall === null || yesterday === null) return null;
  const today = wallToInstant(todayWall, frame.offsetAt).epochMs;
  return atClock(today <= frame.referenceMs + DISPLAY_SKEW_MS ? frame.today : yesterday, minuteOfDay, frame);
}

/** Minutes since local midnight, or null for an impossible clock ("13:03 PM", "0:30 AM", "24:00", "2:60"). */
function parseClock(hourText: string, minuteText: string, meridiem: string | undefined): number | null {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (minute >= MINUTES_PER_HOUR) return null;
  if (meridiem === undefined) return hour < HOURS_PER_DAY ? hour * MINUTES_PER_HOUR + minute : null;
  if (hour < 1 || hour > HOURS_PER_HALF_DAY) return null;
  const afternoon = meridiem === 'pm' ? HOURS_PER_HALF_DAY : 0;
  return ((hour % HOURS_PER_HALF_DAY) + afternoon) * MINUTES_PER_HOUR + minute;
}

function indexOfName(table: readonly (readonly string[])[], word: string): number {
  return table.findIndex((names) => names.includes(word));
}

function previousWeekday(weekday: number, today: CivilDate): CivilDate | null {
  const todayWeekday = weekdayOf(today);
  if (todayWeekday === null) return null;
  const difference = (((todayWeekday - weekday) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(today, -(difference === 0 ? DAYS_PER_WEEK : difference));
}

/**
 * The latest existing `month`/`day` on or before `today`. Year 0 is a leap year in the proleptic Gregorian
 * calendar, so a date that exists in no year (Feb 30) is rejected first and the loop ends within eight years.
 */
function latestOnOrBefore(month: number, day: number, today: CivilDate): CivilDate | null {
  if (wallClockMs({ year: 0, month, day }, 0) === null) return null;
  for (let year = today.year; year >= 0; year -= 1) {
    const date = { year, month, day };
    if (wallClockMs(date, 0) !== null && compareDates(date, today) <= 0) return date;
  }
  return null;
}

function parseMonthDay(text: string, today: CivilDate): CivilDate | null {
  const groups = (MONTH_FIRST.exec(text) ?? DAY_FIRST.exec(text))?.groups;
  if (groups === undefined) return null;
  const monthIndex = indexOfName(MONTH_NAMES, groups.month ?? '');
  if (monthIndex < 0) return null;
  const month = monthIndex + 1;
  const day = Number(groups.day);
  if (groups.year === undefined) return latestOnOrBefore(month, day, today);
  const date = { year: Number(groups.year), month, day };
  return wallClockMs(date, 0) === null ? null : date;
}

function parseDate(text: string, today: CivilDate): CivilDate | null {
  if (text === 'today') return today;
  if (text === 'yesterday') return addDays(today, -1);
  const groups = WEEKDAY_FIRST.exec(text)?.groups;
  const weekday = indexOfName(WEEKDAY_NAMES, groups?.weekday ?? '');
  if (groups === undefined || weekday < 0) return parseMonthDay(text, today);
  if (groups.rest === undefined) return previousWeekday(weekday, today);
  const date = parseMonthDay(groups.rest, today);
  return date !== null && weekdayOf(date) === weekday ? date : null;
}

function resolveDateTime(clean: string, frame: Frame): ResolvedTime | null {
  const clock = CLOCK_AT_END.exec(clean)?.groups;
  if (clock === undefined) {
    const date = parseDate(clean, frame.today);
    return date === null ? null : startOfDay(date, frame);
  }
  const minuteOfDay = parseClock(clock.hour ?? '', clock.minute ?? '', clock.meridiem);
  if (minuteOfDay === null) return null;
  if (clock.date === undefined) return clockOnly(minuteOfDay, frame);
  const date = parseDate(clock.date, frame.today);
  return date === null ? null : atClock(date, minuteOfDay, frame);
}

function isRepresentable(epochMs: number): boolean {
  return !Number.isNaN(new Date(epochMs).getTime());
}

/** The finest precision, from `unit` up, whose aligned unit containing `earliest` also contains `latest`. */
function enclosing(earliest: number, latest: number, unit: TimePrecision, frame: Frame): ResolvedTime | null {
  if (!isRepresentable(earliest)) return null;
  const offsetMs = offsetAtChecked(frame.offsetAt, earliest) * MS_PER_MINUTE;
  for (const precision of PRECISIONS.slice(PRECISIONS.indexOf(unit))) {
    const size = UNIT_MS[precision];
    const start = Math.floor((earliest + offsetMs) / size) * size - offsetMs;
    if (start + size >= latest) return resolved(earliest, precision, frame);
  }
  return null;
}

function resolveAgo(clean: string, frame: Frame): ResolvedTime | null {
  const groups = AGO.exec(clean)?.groups;
  const unit = AGO_UNITS.get(groups?.unit ?? '');
  const countText = groups?.count ?? '';
  const count = ONE.has(countText) ? 1 : Number(countText);
  if (unit === undefined || !Number.isSafeInteger(count)) return null;
  if (unit === 'day') {
    const date = addDays(frame.today, -count);
    return date === null ? null : startOfDay(date, frame);
  }
  const latest = frame.referenceMs - count * UNIT_MS[unit];
  return enclosing(latest - UNIT_MS[unit], latest, unit, frame);
}

/**
 * Resolves vendor-relative text against `referenceIso` in the zone described by `offsetAt` (rules above).
 * Returns null for text it does not understand or that does not name a time unambiguously enough. Throws
 * `NormalizeError` only for a bad `referenceIso` or an `offsetAt` that returns an impossible offset.
 */
export function resolveRelative(text: string, context: RelativeContext): ResolvedTime | null {
  const referenceMs = instantMs(context.referenceIso);
  const today = civilDateAt(referenceMs, offsetAtChecked(context.offsetAt, referenceMs));
  if (today === null) throw new NormalizeError('invalid_iso');
  const frame: Frame = { referenceMs, today, offsetAt: context.offsetAt };
  if (readsDifferently(text)) return null;
  const clean = cleanText(text);
  try {
    return AGO.test(clean) ? resolveAgo(clean, frame) : resolveDateTime(clean, frame);
  } catch (error) {
    // A date that cannot be written as a four-digit-year ISO timestamp is not a time we can claim.
    if (error instanceof NormalizeError && error.code === 'invalid_instant') return null;
    throw error;
  }
}
