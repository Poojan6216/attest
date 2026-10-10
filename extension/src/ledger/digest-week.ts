/**
 * The weeks of the weekly digest (sprint_4 4.7), on the browser's clock: Monday 00:00 to the next Monday 00:00, as the
 * person's own calendar has them, so a week across a change to or from daylight saving time is 167 or 169 hours, and
 * the digest is always made on Monday at 09:00 (src/config.ts DIGEST_WEEKDAY, DIGEST_HOUR). Pure, apart from reading the
 * local time zone through `Date`.
 */
import { DIGEST_HOUR, DIGEST_WEEKDAY } from '../config';
import { twoDigits } from '../core/calendar-words';

export interface DigestWeek {
  /** The week's Monday, `YYYY-MM-DD`: the digest's key. */
  readonly week: string;
  readonly fromMs: number;
  readonly toMs: number;
}

export interface WeekDay {
  readonly date: string;
  readonly startMs: number;
  readonly endMs: number;
}

const DAYS_PER_WEEK = 7;

/** `day`'s local calendar date, `YYYY-MM-DD` (the side panel's filters write theirs through this too). */
export function localDate(day: Date): string {
  return `${String(day.getFullYear())}-${twoDigits(day.getMonth() + 1)}-${twoDigits(day.getDate())}`;
}

/** Midnight of `days` calendar days after `day`'s midnight, on the local clock. */
function daysAfter(day: Date, days: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Monday 00:00 of the week holding `ms`, on the local clock. */
function mondayOf(ms: number): Date {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return daysAfter(day, -((day.getDay() - DIGEST_WEEKDAY + DAYS_PER_WEEK) % DAYS_PER_WEEK));
}

/** The last whole week before `nowMs`: from the Monday before the current week's Monday, to that Monday. */
export function lastWeek(nowMs: number): DigestWeek {
  const to = mondayOf(nowMs);
  const from = daysAfter(to, -DAYS_PER_WEEK);
  return { week: localDate(from), fromMs: from.getTime(), toMs: to.getTime() };
}

/** The next digest instant after `nowMs`: the next Monday at DIGEST_HOUR:00 on the local clock. */
export function nextDigestMs(nowMs: number): number {
  for (let weeks = 0; ; weeks += 1) {
    const at = daysAfter(mondayOf(nowMs), weeks * DAYS_PER_WEEK);
    at.setHours(DIGEST_HOUR, 0, 0, 0);
    if (at.getTime() > nowMs) return at.getTime();
  }
}

/** The seven local days of `week`, Monday first. */
export function weekDays(week: DigestWeek): WeekDay[] {
  const monday = new Date(week.fromMs);
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
    const start = daysAfter(monday, index);
    return { date: localDate(start), startMs: start.getTime(), endMs: daysAfter(start, 1).getTime() };
  });
}
