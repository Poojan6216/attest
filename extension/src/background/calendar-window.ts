/**
 * What a `gcal.event` coverage window can be (sprint_2 2.7; SEC-8; docs/grading.md §3; Hard Rule 5). PURE.
 *
 * The Calendar observer sends one window per run of whole visible days (src/observers/gcal/pass.ts): from the first
 * instant of a day to the first instant of the day after the run, in a range of at most MAX_RANGE_DAYS days. So:
 *  - `calendarWindowFits`: every `gcal.event` ping, with an account or without, spans at least one day and at most
 *    MAX_RANGE_DAYS days (each an hour either way, for a DST change). The service worker refuses (`invalid_input`,
 *    DEGRADED) any other: a window that long was never seen, and one with no account would otherwise be recorded as
 *    it came, counting for grace and keeping rows from being orphans over its whole span (src/background/
 *    observer-messages.ts `pingProblem`).
 *  - `windowInRange`: a ping of a pass with an account must also lie inside that pass's snapshot, on days it saw
 *    whole (./calendar-pass.ts step 1).
 */
import { instantMs } from '../core/normalize';
import { MS_PER_MINUTE } from '../core/units';
import type { CoveragePing } from '../ledger/types';
import { dayFromIso, dayIso, nextDay } from '../observers/gcal/days';
import { type CalendarSnapshot, MAX_RANGE_DAYS } from '../observers/gcal/snapshot';

const HOUR_MS = 60 * MS_PER_MINUTE;
const DAY_MS = 24 * HOUR_MS;

/** The shortest window an observer sends: one day, less an hour for a DST change. */
export const MIN_CALENDAR_WINDOW_MS = DAY_MS - HOUR_MS;

/** The longest: MAX_RANGE_DAYS days, plus an hour for a DST change. */
export const MAX_CALENDAR_WINDOW_MS = MAX_RANGE_DAYS * DAY_MS + HOUR_MS;

/** Whether a `gcal.event` window spans what one run of whole visible days can (see the module comment). */
export function calendarWindowFits(window: {
  readonly windowStart: string;
  readonly windowEnd: string;
}): boolean {
  const span = instantMs(window.windowEnd) - instantMs(window.windowStart);
  return span >= MIN_CALENDAR_WINDOW_MS && span <= MAX_CALENDAR_WINDOW_MS;
}

/** The day after a `YYYY-MM-DD` day, as `YYYY-MM-DD` (calendar arithmetic: no zone is involved); null if none. */
function dayAfter(day: string): string | null {
  const parsed = dayFromIso(day);
  const after = parsed === null ? null : nextDay(parsed);
  return after === null ? null : dayIso(after);
}

/**
 * Whether a ping's window lies inside the snapshot's range, on days the snapshot saw whole: it starts on a visible
 * day and ends no later than the midnight after the last one (both read as the local dates the observer wrote them
 * in), and every day it reaches into is whole: its first day, and each visible day before the day its end falls on (a
 * window ends at the first instant of the day after its run, which may be a hidden one). A window over a day hidden
 * behind "N more" would report that day as seen (Hard Rule 5): the observer never sends one (src/observers/gcal/
 * pass.ts), so one that does is refused.
 */
export function windowInRange(ping: CoveragePing, snapshot: CalendarSnapshot): boolean {
  const first = snapshot.days[0]?.date;
  const last = snapshot.days[snapshot.days.length - 1]?.date;
  if (first === undefined || last === undefined) return false;
  const startDay = ping.windowStart.slice(0, 10);
  const endDay = ping.windowEnd.slice(0, 10);
  const afterLast = dayAfter(last);
  if (afterLast === null || startDay < first || startDay > last || endDay > afterLast) return false;
  const reached = (date: string): boolean => date === startDay || (date > startDay && date < endDay);
  return snapshot.days.every((day) => day.complete || !reached(day.date));
}
