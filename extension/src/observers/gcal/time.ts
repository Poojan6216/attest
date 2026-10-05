/**
 * Calendar times (sprint_2 2.5; agents/adapter_engineer.md rule 7; docs/grading.md §11).
 *
 * Google Calendar writes every event in the time zone of Calendar's own setting, which can differ from the
 * browser's. A chip label names a wall time with its own date ("October 5, 2026", "10:30am"), never a time
 * relative to now, so the instant the page was read is never a reference here: a page read at 00:30 gives the same
 * instants as one read at noon. A wall time becomes an instant through an injected UTC-offset function (the
 * browser's zone, checked against the page's own "GMT-04" hint by ./page.ts), and a wall time that a DST change
 * skips or repeats names no single instant: it is reported as such, never guessed (Hard Rule 5).
 *
 * Pure: no clock, no I/O, no time-zone database of its own.
 */
import { isoWithOffset, type OffsetAt } from '../../core/normalize';
import { wallToInstant } from '../../core/normalize-time';
import { MS_PER_MINUTE } from '../../core/units';
import { type CivilDay, civilDay } from './days';
import { GCAL_SELECTORS, ZONE_PATTERN } from './selectors';

// The plain-day helpers live in ./days.ts (no selectors), so the snapshot and the diff never load ./selectors.json.
export { type CivilDay, civilDay, dayFromIso, dayIso, nextDay } from './days';

/** An instant as epoch ms and as ISO 8601 written in the offset in force at it. */
export interface Instant {
  readonly ms: number;
  readonly iso: string;
}

const MINUTES_PER_HOUR = 60;
const HOURS_PER_HALF_DAY = 12;
const MINUTES_PER_DAY = 1_440;

const DAY_TEXT = /^(\p{Lu}\p{Ll}+) (\d{1,2}), (\d{4})$/u;
const CLOCK_12 = /^(\d{1,2})(?::(\d{2}))?\s?([ap])m$/iu;
const CLOCK_24 = /^(\d{1,2}):(\d{2})$/u;

/** "October 5, 2026" (an English month name, as Calendar writes it) → the day, or null. */
export function parseDay(text: string): CivilDay | null {
  const match = DAY_TEXT.exec(text);
  if (match === null) return null;
  const [, monthName = '', day = '', year = ''] = match;
  const month = GCAL_SELECTORS.text.months.indexOf(monthName) + 1;
  return month === 0 ? null : civilDay(Number(year), month, Number(day));
}

/** "10am", "10:30am", "12pm", "10:30 PM" or "14:05" → the minute of the day, or null. */
export function parseClock(text: string): number | null {
  const twelve = CLOCK_12.exec(text);
  if (twelve !== null) {
    const [, hourText = '', minuteText = '0', half = ''] = twelve;
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (hour < 1 || hour > HOURS_PER_HALF_DAY || minute >= MINUTES_PER_HOUR) return null;
    const pm = half.toLowerCase() === 'p' ? HOURS_PER_HALF_DAY : 0;
    return ((hour % HOURS_PER_HALF_DAY) + pm) * MINUTES_PER_HOUR + minute;
  }
  const full = CLOCK_24.exec(text);
  if (full === null) return null;
  const hour = Number(full[1]);
  const minute = Number(full[2]);
  return hour < 2 * HOURS_PER_HALF_DAY && minute < MINUTES_PER_HOUR ? hour * MINUTES_PER_HOUR + minute : null;
}

function wallMs(day: CivilDay, minute: number): number {
  return Date.UTC(day.year, day.month - 1, day.day) + minute * MS_PER_MINUTE;
}

function instantAt(ms: number, offsetAt: OffsetAt): Instant {
  return { ms, iso: isoWithOffset(ms, offsetAt(ms)) };
}

/**
 * The instant at which `day` shows wall time `minute` (0 ≤ minute < 1440) in the zone `offsetAt` describes, or
 * null when that wall time occurs twice or never there (a DST change): such a time names no single instant.
 */
export function localInstant(day: CivilDay, minute: number, offsetAt: OffsetAt): Instant | null {
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) return null;
  const wall = wallToInstant(wallMs(day, minute), offsetAt);
  return wall.exact ? instantAt(wall.epochMs, offsetAt) : null;
}

/**
 * The first instant of `day`: its local midnight; of two midnights (clocks went back at midnight), the earlier;
 * when a DST gap swallowed midnight, the first instant after the gap. A day always starts, so never null.
 */
export function dayStart(day: CivilDay, offsetAt: OffsetAt): Instant {
  return instantAt(wallToInstant(wallMs(day, 0), offsetAt).epochMs, offsetAt);
}

/** The signs a zone hint may write west of UTC: the hyphen-minus and U+2212 MINUS SIGN. */
const WEST = new Set(['-', '−']);

/**
 * The UTC offset in minutes a "GMT-04" / "GMT−04" (U+2212) / "GMT+05:30" / "GMT" hint names, or null when `text` is
 * not one.
 */
export function zoneHintMinutes(text: string): number | null {
  const match = ZONE_PATTERN.exec(text);
  if (match === null) return null;
  const [, sign = '+', hours = '0', minutes = '0'] = match;
  const magnitude = Number(hours) * MINUTES_PER_HOUR + Number(minutes);
  if (Number(minutes) >= MINUTES_PER_HOUR || magnitude >= MINUTES_PER_DAY) return null;
  return WEST.has(sign) && magnitude > 0 ? -magnitude : magnitude;
}

/** The offset in force at noon UTC of `day`: a day's offset away from any night-time DST change. */
export function noonOffset(day: CivilDay, offsetAt: OffsetAt): number {
  return offsetAt(wallMs(day, HOURS_PER_HALF_DAY * MINUTES_PER_HOUR));
}
