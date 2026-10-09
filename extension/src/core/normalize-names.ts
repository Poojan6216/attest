/**
 * Weekday and month names, and clock parts, as dates and times are written (docs/grading.md §11): ASCII tables and
 * integer arithmetic only, shared by the page-time resolver (./normalize-relative.ts) and the event-start reader
 * (./normalize-upcoming.ts). Nothing here reads a character property from the engine (Hard Rule 4).
 */
import { HOURS_PER_DAY } from './normalize-time';
import { HOURS_PER_HALF_DAY, MINUTES_PER_HOUR } from './units';

export const WEEKDAY_NAMES: readonly (readonly string[])[] = [
  ['sun', 'sunday'],
  ['mon', 'monday'],
  ['tue', 'tues', 'tuesday'],
  ['wed', 'weds', 'wednesday'],
  ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
];
export const MONTH_NAMES: readonly (readonly string[])[] = [
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

/** Minutes since local midnight, or null for an impossible clock ("13:03 PM", "0:30 AM", "24:00", "2:60"). */
export function parseClock(
  hourText: string,
  minuteText: string,
  meridiem: string | undefined,
): number | null {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (minute >= MINUTES_PER_HOUR) return null;
  if (meridiem === undefined) return hour < HOURS_PER_DAY ? hour * MINUTES_PER_HOUR + minute : null;
  if (hour < 1 || hour > HOURS_PER_HALF_DAY) return null;
  const afternoon = meridiem === 'pm' ? HOURS_PER_HALF_DAY : 0;
  return ((hour % HOURS_PER_HALF_DAY) + afternoon) * MINUTES_PER_HOUR + minute;
}

export function indexOfName(table: readonly (readonly string[])[], word: string): number {
  return table.findIndex((names) => names.includes(word));
}
