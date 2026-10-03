/**
 * Vendor-relative times → `{ start, end, precision }` (docs/grading.md §11, §4.1). Pure; English vendor text only.
 *
 * The reference instant is data (`referenceIso`, normally when the page was read) and the user's time zone is an
 * injected `offsetAt` function; core never reads a clock or a time-zone database (Hard Rule 4). The result is the
 * claim unit of §4.1: the whole minute, hour or local day that contains the text's meaning, as its start and end
 * instants. An adapter sets `claimedAt = start`, `claimedAtEnd = end`, `claimedAtPrecision = precision`. A day
 * runs from one local midnight to the next, found with `offsetAt`, so a day on a DST change is 23 or 25 hours
 * long; a minute or an hour is 1 min or 1 h long. Each instant is written in the offset in which it is local
 * 00:00, hh:00 or hh:mm (normally the offset in force then; the offset before a DST gap that swallowed
 * midnight), so truncating `start` to its unit in its own offset (§4.1, §10) gives `start` back.
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
 *    [ref − (N+1)·unit, ref − N·unit]; the result is the finest unit that contains all of it (a minute or an
 *    hour aligned in the offset at the range start, else that local day), or null if not even the day does.
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
import { asBaseline, BASELINE_CLASS, lowerBaseline, trimBaseline } from './unicode-baseline';
import { DAYS_PER_WEEK, HOURS_PER_HALF_DAY, MINUTES_PER_HOUR, MS_PER_HOUR, MS_PER_MINUTE } from './units';

/** Same values as schema `ClaimPrecision`. */
export type TimePrecision = 'minute' | 'hour' | 'day';

/** One precision unit as ISO 8601 instants (`start` < `end`), each in the offset in which it starts a unit. */
export interface ResolvedTime {
  /** The first instant of the unit: the claim's `claimedAt`. */
  readonly start: string;
  /** The end of the unit, the next unit's start (§4.1 closed interval): the claim's `claimedAtEnd`. */
  readonly end: string;
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

/** A unit boundary: an instant and the UTC offset (minutes) in which it reads 00:00, hh:00 or hh:mm. */
interface Boundary {
  readonly ms: number;
  readonly offset: number;
}

/** A resolved unit, written out as ISO only at the end. */
interface Span {
  readonly start: Boundary;
  readonly end: Boundary;
  readonly precision: TimePrecision;
}

type ClockPrecision = Exclude<TimePrecision, 'day'>;
const CLOCK_PRECISIONS: readonly ClockPrecision[] = ['minute', 'hour'];
const UNIT_MS: Readonly<Record<ClockPrecision, number>> = { minute: MS_PER_MINUTE, hour: MS_PER_HOUR };
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
/** Whitespace as Unicode 15.0 defines it (JS `\s`); `cleanText` turns each run into one ASCII space. */
const WHITESPACE_RUN = new RegExp(`[${BASELINE_CLASS.space}]+`, 'gu');
/* The patterns below read cleaned text, whose only whitespace is a single ' ' between words. */
const AGO = /^(?<count>\d+|an?|one) *(?<unit>[a-z]+)\.? +ago$/;
const CLOCK_AT_END =
  /^(?:(?<date>.*?)[ ,]+(?:at +)?)?(?<hour>\d{1,2}):(?<minute>\d{2}) *(?<meridiem>am|pm)?$/;
const WEEKDAY_FIRST = /^(?<weekday>[a-z]+)\.?(?:,? +(?<rest>.+))?$/;
const MONTH_FIRST = /^(?<month>[a-z]+)\.? +(?<day>\d{1,2})(?:,? +(?<year>\d{4}))?$/;
const DAY_FIRST = /^(?<day>\d{1,2}) +(?<month>[a-z]+)\.?(?:,? +(?<year>\d{4}))?$/;

/**
 * Invisible marks removed, NFKC, lowercase, `a.m.` → `am`, whitespace collapsed and trimmed (Unicode 15.0). The
 * text is put on the baseline first, so removing a mark never joins two lone surrogates into a digit.
 */
function cleanText(text: string): string {
  const folded = lowerBaseline(stripInvisible(stripInvisible(asBaseline(text)).normalize('NFKC')));
  return trimBaseline(folded.replace(MERIDIEM_WITH_DOTS, '$1m').replace(WHITESPACE_RUN, ' '));
}

/** `ms` in the offset in force at that instant. */
function boundaryAt(ms: number, frame: Frame): Boundary {
  return { ms, offset: offsetAtChecked(frame.offsetAt, ms) };
}

/**
 * The first instant of a local date, in the offset in which it reads 00:00: its midnight, or, when a DST gap
 * swallowed midnight, the end of the gap written in the offset before it (wallToInstant's "compatible" rule).
 */
function startOfDay(date: CivilDate, frame: Frame): Boundary | null {
  const wall = wallClockMs(date, 0);
  if (wall === null) return null;
  const ms = wallToInstant(wall, frame.offsetAt).epochMs;
  return { ms, offset: (wall - ms) / MS_PER_MINUTE };
}

/**
 * The whole local day: from its first instant to the next day's (DST-correct: 23, 24 or 25 hours). Null for a
 * date the zone skipped entirely (Samoa jumped from 29 to 31 Dec 2011): nothing happened on it, and a unit with
 * `end` ≤ `start` is not a claim unit (schema Claim requires `claimedAtEnd` after `claimedAt`).
 */
function wholeDay(date: CivilDate, frame: Frame): Span | null {
  const next = addDays(date, 1);
  const start = startOfDay(date, frame);
  const end = next === null ? null : startOfDay(next, frame);
  if (start === null || end === null || end.ms <= start.ms) return null;
  return { start, end, precision: 'day' };
}

function atClock(date: CivilDate, minuteOfDay: number, frame: Frame): Span | null {
  const wall = wallClockMs(date, minuteOfDay);
  if (wall === null) return null;
  const instant = wallToInstant(wall, frame.offsetAt);
  if (!instant.exact) return wholeDay(date, frame);
  const start = boundaryAt(instant.epochMs, frame);
  return { start, end: boundaryAt(instant.epochMs + MS_PER_MINUTE, frame), precision: 'minute' };
}

function clockOnly(minuteOfDay: number, frame: Frame): Span | null {
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

function resolveDateTime(clean: string, frame: Frame): Span | null {
  const clock = CLOCK_AT_END.exec(clean)?.groups;
  if (clock === undefined) {
    const date = parseDate(clean, frame.today);
    return date === null ? null : wholeDay(date, frame);
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

/**
 * The finest unit, from `unit` up, that contains `earliest` and also `latest`: a minute or an hour aligned in
 * the offset at `earliest`, else the local day of `earliest`; null when not even that day contains `latest`.
 */
function enclosing(earliest: number, latest: number, unit: ClockPrecision, frame: Frame): Span | null {
  if (!isRepresentable(earliest)) return null;
  const offset = offsetAtChecked(frame.offsetAt, earliest);
  const offsetMs = offset * MS_PER_MINUTE;
  for (const precision of CLOCK_PRECISIONS.slice(CLOCK_PRECISIONS.indexOf(unit))) {
    const size = UNIT_MS[precision];
    const startMs = Math.floor((earliest + offsetMs) / size) * size - offsetMs;
    if (startMs + size >= latest) {
      return { start: { ms: startMs, offset }, end: boundaryAt(startMs + size, frame), precision };
    }
  }
  const date = civilDateAt(earliest, offset);
  const day = date === null ? null : wholeDay(date, frame);
  return day !== null && day.end.ms >= latest ? day : null;
}

function resolveAgo(clean: string, frame: Frame): Span | null {
  const groups = AGO.exec(clean)?.groups;
  const unit = AGO_UNITS.get(groups?.unit ?? '');
  const countText = groups?.count ?? '';
  const count = ONE.has(countText) ? 1 : Number(countText);
  if (unit === undefined || !Number.isSafeInteger(count)) return null;
  if (unit === 'day') {
    const date = addDays(frame.today, -count);
    return date === null ? null : wholeDay(date, frame);
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
    const span = AGO.test(clean) ? resolveAgo(clean, frame) : resolveDateTime(clean, frame);
    if (span === null) return null;
    const { start, end, precision } = span;
    return {
      start: isoWithOffset(start.ms, start.offset),
      end: isoWithOffset(end.ms, end.offset),
      precision,
    };
  } catch (error) {
    // A date that cannot be written as a four-digit-year ISO timestamp is not a time we can claim.
    if (error instanceof NormalizeError && error.code === 'invalid_instant') return null;
    throw error;
  }
}
