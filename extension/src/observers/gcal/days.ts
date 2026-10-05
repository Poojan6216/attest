/**
 * Calendar days as plain dates (sprint_2 2.5; TECH-7): what a day is, its `YYYY-MM-DD` spelling and the day after it.
 *
 * Kept apart from ./time.ts, which reads the page's month names and zone hint from ./selectors.json: the snapshot
 * schema (./snapshot.ts) and the diff (./diff.ts) need days too, and the service worker and the ledger import those
 * two. Nothing here reads the selectors, the DOM or the clock, so the worker never parses the Calendar selectors when
 * it starts (a selectors.json that fails its schema stops the Calendar content script only, never the worker).
 *
 * Pure: no clock, no I/O, no time zone.
 */

/** A calendar day, month 1–12. */
export interface CivilDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const FIRST_YEAR = 1970;
const LAST_YEAR = 9999;
const DAY_ISO = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** `year-month-day` when it is a real day in 1970–9999, else null. */
export function civilDay(year: number, month: number, day: number): CivilDay | null {
  if (![year, month, day].every(Number.isInteger) || year < FIRST_YEAR || year > LAST_YEAR) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  const real = at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/** "2026-10-05" → the day, or null. */
export function dayFromIso(text: string): CivilDay | null {
  const match = DAY_ISO.exec(text);
  if (match === null) return null;
  const [, year = '', month = '', day = ''] = match;
  return civilDay(Number(year), Number(month), Number(day));
}

/** The day as `YYYY-MM-DD`. */
export function dayIso(day: CivilDay): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${String(day.year).padStart(4, '0')}-${two(day.month)}-${two(day.day)}`;
}

/** The day after `day` (null past 9999-12-31). */
export function nextDay(day: CivilDay): CivilDay | null {
  const at = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
  return civilDay(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}
