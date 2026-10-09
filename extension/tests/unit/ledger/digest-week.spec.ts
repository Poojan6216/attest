/**
 * The weeks of the weekly digest (sprint_4 4.7; src/ledger/digest-week.ts), on whatever clock the tests run on (`pnpm
 * test:tz` runs them in several time zones): the next digest is always a Monday at 09:00, the soonest after now; the
 * last whole week runs from a Monday's midnight to the next Monday's midnight, the one before now's week; and its seven
 * days are the calendar's own, each a midnight to the next, however long a day across a daylight saving change is.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { lastWeek, localDate, nextDigestMs, weekDays } from '../../../src/ledger/digest-week';

const DAY_MS = 86_400_000;
const START_2026 = Date.UTC(2026, 0, 1);
const END_2027 = Date.UTC(2028, 0, 1);
const instant = fc.integer({ min: START_2026, max: END_2027 });

/** Whether `ms` is the first instant of its local date: its midnight, or the hour a clock change skipped to. */
const isMidnight = (ms: number): boolean => localDate(new Date(ms - 1)) !== localDate(new Date(ms));

describe('nextDigestMs', () => {
  it('is the soonest Monday 09:00 after now, on the local clock', () => {
    fc.assert(
      fc.property(instant, (nowMs) => {
        const next = nextDigestMs(nowMs);
        const at = new Date(next);
        expect([at.getDay(), at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([1, 9, 0, 0]);
        expect(next).toBeGreaterThan(nowMs);
        // Nothing sooner: a week before it is at or before now (8 days, for a week a clock change made longer).
        expect(next - nowMs).toBeLessThanOrEqual(8 * DAY_MS);
        expect(nextDigestMs(next - 1)).toBe(next);
      }),
      { numRuns: 2000 },
    );
  });

  it('on a Monday: today at 09:00 before it, a week on at or after it', () => {
    const monday = new Date(2026, 9, 12, 8, 59);
    expect(new Date(nextDigestMs(monday.getTime())).getDate()).toBe(12);
    monday.setHours(9, 0, 0, 0);
    expect(new Date(nextDigestMs(monday.getTime())).getDate()).toBe(19);
  });
});

describe('lastWeek and weekDays', () => {
  it("is the last whole week before now's: Monday midnight to Monday midnight, seven calendar days", () => {
    fc.assert(
      fc.property(instant, (nowMs) => {
        const week = lastWeek(nowMs);
        expect(new Date(week.fromMs).getDay()).toBe(1);
        expect(new Date(week.toMs).getDay()).toBe(1);
        expect(isMidnight(week.fromMs) && isMidnight(week.toMs)).toBe(true);
        expect(week.toMs).toBeLessThanOrEqual(nowMs);
        expect(nowMs - week.toMs).toBeLessThan(7 * DAY_MS + 3_600_000);
        expect(week.week).toBe(localDate(new Date(week.fromMs)));
        const days = weekDays(week);
        expect(days).toHaveLength(7);
        expect(days[0]?.startMs).toBe(week.fromMs);
        expect(days.at(-1)?.endMs).toBe(week.toMs);
        days.forEach((day, index) => {
          expect(isMidnight(day.startMs)).toBe(true);
          expect(day.date).toBe(localDate(new Date(day.startMs)));
          expect(new Date(day.startMs).getDay()).toBe((index + 1) % 7);
          if (index > 0) expect(day.startMs).toBe(days[index - 1]?.endMs);
        });
      }),
      { numRuns: 2000 },
    );
  });

  it('names the week by its Monday', () => {
    expect(lastWeek(new Date(2026, 9, 12, 9, 30).getTime()).week).toBe('2026-10-05');
    expect(lastWeek(new Date(2026, 9, 18, 23, 0).getTime()).week).toBe('2026-10-05');
  });
});
