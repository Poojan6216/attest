/**
 * An event's start as a claim's own words name it (sprint_3 3.15; docs/grading.md §4.1 `targetAt`): "Thu 2pm",
 * "Thursday at 2:00 pm", "Friday at noon", "Oct 8 at 2pm", "8 October, 14:00", "tomorrow at 9am". Read FORWARD from
 * the instant the claim was made, in the user's zone, where ./normalize-relative.ts reads a page's own timestamps
 * backward.
 *
 * Only a day followed by a time of day is read. Anything else gives null, and the claim no `targetAt` (`no_target`,
 * UNVERIFIABLE): a calendar claim is graded over a window around its target, and a wrong target could make a true
 * claim NOT_FOUND (Hard Rule 5).
 *  - The day: a weekday (the first on or after the claim's day), `today`, `tomorrow`, or a month and day (the first
 *    on or after the claim's day; with a year, exactly that date). A weekday with a date must agree with it.
 *  - The time: `2pm`, `2 pm`, `2:00 pm`, `14:00` or `noon`. `midnight` is not read: which night it closes is unclear.
 *  - A weekday or a date that falls on the claim's own day, at a time already past when the claim was made, is
 *    ambiguous (today, or a week or a year later?) and gives null; so does a time that happens twice or never on that
 *    day (a DST change). `today` names the day itself, so its time may lie before the claim.
 * PURE (Hard Rule 4).
 */
import { indexOfName, MONTH_NAMES, parseClock, WEEKDAY_NAMES } from './normalize-names';
import type { RelativeContext } from './normalize-relative';
import {
  addDays,
  type CivilDate,
  civilDateAt,
  compareDates,
  instantMs,
  isoWithOffset,
  offsetAtChecked,
  wallClockMs,
  wallToInstant,
  weekdayOf,
} from './normalize-time';
import { DAYS_PER_WEEK, HOURS_PER_HALF_DAY, MINUTES_PER_HOUR } from './units';

/**
 * Every weekday and month name of ./normalize-names.ts WEEKDAY_NAMES and MONTH_NAMES, longest first, written out:
 * the core's Unicode fence admits only patterns spelled in the file (tests/unit/core/unicode-fence.spec.ts), and
 * tests/unit/core/normalize-upcoming.spec.ts holds these to the tables.
 */
export const WEEKDAY =
  '(?:wednesday|thursday|saturday|tuesday|sunday|monday|friday|thurs|thur|tues|weds|sun|mon|tue|wed|thu|fri|sat)\\.?';
export const MONTH =
  '(?:september|february|november|december|january|october|august|april|march|sept|june|july|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\\.?';
const MONTH_DAY = `(?:${MONTH} \\d{1,2}(?:,? \\d{4})?|\\d{1,2} ${MONTH}(?: \\d{4})?)`;
const DAY = `(?:today|tomorrow|${WEEKDAY}(?:,? ${MONTH_DAY})?|${MONTH_DAY})`;
const CLOCK = '(?:noon|\\d{1,2}(?::\\d{2})? ?(?:am|pm)|\\d{1,2}:\\d{2})';
/** A day, then its time, in cleaned text (one space between words): the first one a sentence holds is the start. */
const PHRASE = new RegExp(`(?<![a-z0-9])(?<day>${DAY})(?:,? at |,? )(?<clock>${CLOCK})(?![a-z0-9:])`, 'u');
const CLOCK_PARTS = /^(?<hour>\d{1,2})(?::(?<minute>\d{2}))? ?(?<meridiem>am|pm)?$/u;
const MONTH_DAY_PARTS = new RegExp(
  `^(?:(?<month>[a-z]+)\\.? (?<day>\\d{1,2})|(?<day2>\\d{1,2}) (?<month2>[a-z]+)\\.?)(?:,? (?<year>\\d{4}))?$`,
  'u',
);

/** Minutes since local midnight of a clock as a claim writes one, or null. */
function minuteOf(clock: string): number | null {
  if (clock === 'noon') return HOURS_PER_HALF_DAY * MINUTES_PER_HOUR;
  const parts = CLOCK_PARTS.exec(clock)?.groups;
  if (parts === undefined) return null;
  return parseClock(parts.hour ?? '', parts.minute ?? '00', parts.meridiem);
}

/** The first `month`/`day` on or after `from` (with `year`, exactly that date), or null for a date no year has. */
function monthDayFrom(text: string, from: CivilDate): CivilDate | null {
  const g = MONTH_DAY_PARTS.exec(text)?.groups;
  const monthIndex = indexOfName(MONTH_NAMES, g?.month ?? g?.month2 ?? '');
  if (g === undefined || monthIndex < 0) return null;
  const date = { year: Number(g.year ?? from.year), month: monthIndex + 1, day: Number(g.day ?? g.day2) };
  if (g.year !== undefined || compareDates(date, from) >= 0)
    return wallClockMs(date, 0) === null ? null : date;
  const next = { ...date, year: from.year + 1 };
  return wallClockMs(next, 0) === null ? null : next;
}

/** The date a day names, forward from `from`, and whether it names that date itself (`today`, `tomorrow`). */
function dayFrom(
  text: string,
  from: CivilDate,
): { readonly date: CivilDate; readonly named: boolean } | null {
  if (text === 'today') return { date: from, named: true };
  if (text === 'tomorrow') {
    const date = addDays(from, 1);
    return date === null ? null : { date, named: true };
  }
  const [first = '', ...rest] = text.split(/,? /u);
  const weekday = indexOfName(WEEKDAY_NAMES, first.replace(/\.$/u, ''));
  if (weekday < 0) {
    const date = monthDayFrom(text, from);
    return date === null ? null : { date, named: false };
  }
  if (rest.length > 0) {
    const date = monthDayFrom(rest.join(' '), from);
    return date !== null && weekdayOf(date) === weekday ? { date, named: false } : null;
  }
  const today = weekdayOf(from);
  const date = today === null ? null : addDays(from, (weekday - today + DAYS_PER_WEEK) % DAYS_PER_WEEK);
  return date === null ? null : { date, named: false };
}

/**
 * The start of the event the first day-and-time phrase of `clean` names, read forward from `context.referenceIso` (the
 * claim's own time) in the user's zone, as ISO 8601 in the offset in force then; null when it names none, or none
 * unambiguously (rules in the file comment). `clean` is a sentence as ./normalize-relative.ts `cleanText` leaves it:
 * the reader there, `upcomingIn`, is the one entry (its Unicode handling is the resolver's, held by the later-engine
 * property).
 */
export function upcomingInClean(clean: string, context: RelativeContext): string | null {
  const phrase = PHRASE.exec(clean)?.groups;
  if (phrase === undefined) return null;
  const referenceMs = instantMs(context.referenceIso);
  const from = civilDateAt(referenceMs, offsetAtChecked(context.offsetAt, referenceMs));
  const minute = minuteOf(phrase.clock ?? '');
  const day = from === null ? null : dayFrom(phrase.day ?? '', from);
  if (from === null || minute === null || day === null) return null;
  const wall = wallClockMs(day.date, minute);
  const instant = wall === null ? null : wallToInstant(wall, context.offsetAt);
  if (!instant?.exact) return null;
  if (!day.named && compareDates(day.date, from) === 0 && instant.epochMs < referenceMs) return null;
  return isoWithOffset(instant.epochMs, offsetAtChecked(context.offsetAt, instant.epochMs));
}
