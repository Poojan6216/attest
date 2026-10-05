/**
 * What one Calendar pass reports, from one read of the page (./read.ts): its snapshot and its coverage windows
 * (sprint_2 2.5; docs/grading.md §3, §6.1). The snapshot starts its own chain (`baselineAt` = its `readAt`): the
 * observer never holds a stored snapshot, and the service worker carries a chain's baseline on from its stored base
 * (src/background/calendar-step.ts).
 *
 * Coverage (Hard Rule 5): a window runs from the first instant of a visible day (local midnight, in the zone the
 * times are read in) to the first instant of the day after the last one, so a week reaching into the future is
 * covered into the future (only `gcal.event` may: src/observers/coverage.ts). A day that hides events behind "N
 * more" was not seen whole, so it is left out and the range splits into several windows, each its own coverage.ping
 * (sprint_2 2.7). A clean pass with no whole day reports none: OK, no coverage.
 */
import type { OffsetAt } from '../../core/normalize';
import type { VisibleWindow } from '../types';
import { GcalError } from './errors';
import type { GridDay } from './page';
import { calendarKey, type PageFacts } from './read';
import { GCAL_VERSION } from './selectors';
import { CalendarSnapshot, SNAPSHOT_FORMAT } from './snapshot';
import { dayStart, nextDay } from './time';

/** `<first day>/<last day>` of the visible range: the key a snapshot is stored under. */
export function rangeOf(facts: PageFacts): string {
  return `${facts.days[0]?.iso ?? ''}/${facts.days[facts.days.length - 1]?.iso ?? ''}`;
}

/** The snapshot of `facts` read at `readAt` (the pass instant). Throws `GcalError('invalid_snapshot')` on a bug. */
export function snapshotOf(facts: PageFacts, readAt: string): CalendarSnapshot {
  const range = rangeOf(facts);
  const calendars = new Map<string, { shown: boolean; listed: number }>();
  for (const calendar of facts.calendars) {
    const key = calendarKey(calendar.name);
    const seen = calendars.get(key);
    calendars.set(key, {
      shown: (seen?.shown ?? false) || calendar.shown,
      listed: (seen?.listed ?? 0) + 1,
    });
  }
  const parsed = CalendarSnapshot.safeParse({
    format: SNAPSHOT_FORMAT,
    observer: 'gcal.event',
    version: GCAL_VERSION,
    range,
    readAt,
    baselineAt: readAt,
    days: facts.days.map((day) => ({ date: day.iso, complete: day.complete })),
    calendars: [...calendars.entries()].map(([key, { shown, listed }]) =>
      listed > 1 ? { key, shown, ambiguous: true } : { key, shown },
    ),
    events: facts.events.map((event) => ({ ...event, calendar: calendarKey(event.calendar) })),
  });
  if (!parsed.success) throw new GcalError('invalid_snapshot');
  return parsed.data;
}

/** Runs of consecutive whole days. */
function wholeRuns(days: readonly GridDay[]): GridDay[][] {
  const runs: GridDay[][] = [];
  let open: GridDay[] | null = null;
  for (const day of days) {
    if (!day.complete) {
      open = null;
    } else if (open === null) {
      open = [day];
      runs.push(open);
    } else {
      open.push(day);
    }
  }
  return runs;
}

/** Every window the pass saw whole, in order (docs/grading.md §3: `windowStart..windowEnd`). */
export function coverageWindows(facts: PageFacts, offsetAt: OffsetAt): VisibleWindow[] {
  return wholeRuns(facts.days).flatMap((run) => {
    const first = run[0];
    const last = run[run.length - 1];
    const after = last === undefined ? null : nextDay(last.day);
    if (first === undefined || after === null) return [];
    return [{ windowStart: dayStart(first.day, offsetAt).iso, windowEnd: dayStart(after, offsetAt).iso }];
  });
}
