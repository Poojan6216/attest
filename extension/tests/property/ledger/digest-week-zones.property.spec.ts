/**
 * The weekly digest's weeks in many time zones (sprint_4 4.7; src/ledger/digest-week.ts; Decisions [4.7]: "tested over
 * 2,000 random instants in New York, Santiago, Lord Howe, Kiritimati, St John's and Tehran"). tests/unit/ledger/
 * digest-week.spec.ts runs in the host's zone only (`pnpm test:tz` reruns tests/unit/core, tests/property and
 * tests/golden, not tests/unit/ledger), so the claim had no test in the tree (Sprint 4 QA review). Here each zone is set
 * inside the worker (Node reads `process.env.TZ` when it is assigned, as tests/golden/timezones.spec.ts does), proved to
 * have taken effect, and the week math is held to an oracle written from the local calendar:
 *  - the next digest is the soonest Monday 09:00:00.000 after now, and the one a week before it is not after now;
 *  - the last whole week runs from the first instant of the Monday a week before now's Monday to the first instant of
 *    now's Monday, keyed by that first Monday;
 *  - its seven days are consecutive local dates, Monday first, each from its first instant to the next day's, however
 *    long a day across a clock change is; the week is 167 to 169 hours long.
 * The zones add Havana, whose clocks change at midnight (a Sunday that starts at 01:00 in March, and one whose
 * midnight comes twice in November), Santiago's Sunday that starts at 01:00, and Chatham's 45-minute offsets. Each
 * zone's own clock changes in 2026 and 2027 are checked one by one, besides 1,000 random instants per zone.
 */
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';

import { DIGEST_HOUR } from '../../../src/config';
import { lastWeek, localDate, nextDigestMs, weekDays } from '../../../src/ledger/digest-week';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 0, 1);
const END = Date.UTC(2028, 0, 1);
const RUNS = { numRuns: 1_000 };

/** Each zone, and its offset east of UTC in minutes on 15 January and 15 July 2026. */
const ZONES: readonly (readonly [zone: string, january: number, july: number])[] = [
  ['America/New_York', -300, -240],
  ['America/Santiago', -180, -240],
  ['Australia/Lord_Howe', 660, 630],
  ['Pacific/Kiritimati', 840, 840],
  ['America/St_Johns', -210, -150],
  ['Asia/Tehran', 210, 210],
  ['America/Havana', -300, -240],
  ['Pacific/Chatham', 825, 765],
];

const HOST_ZONE = process.env.TZ;

function useZone(zone: string | undefined): void {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
}

afterAll(() => {
  useZone(HOST_ZONE);
});

const offsetAt = (ms: number): number => 0 - new Date(ms).getTimezoneOffset();

/**
 * The first instant of the local date `days` after the local date of `ms` (its midnight, or the hour a change skipped
 * to), found by bisection on whole minutes between an instant of the day before (its noon less 15 hours) and the day's
 * noon. Every zone's offset is a whole number of minutes, so a date begins on a minute.
 */
function dayStart(ms: number, days = 0): number {
  const day = new Date(ms);
  const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate() + days, 12).getTime();
  const target = localDate(new Date(noon));
  let before = noon - 15 * HOUR;
  let within = noon;
  expect(localDate(new Date(before))).not.toBe(target);
  while (within - before > 60_000) {
    const mid = before + Math.floor((within - before) / 120_000) * 60_000;
    if (localDate(new Date(mid)) === target) within = mid;
    else before = mid;
  }
  return within;
}

/** Days since Monday (0 to 6) of the local date of `ms`. */
const sinceMonday = (ms: number): number => (new Date(ms).getDay() + 6) % 7;

/** The Monday 09:00 of the local week holding `ms`, `weeks` weeks later. */
function mondayNine(ms: number, weeks: number): number {
  const day = new Date(ms);
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - sinceMonday(ms) + 7 * weeks);
  monday.setHours(DIGEST_HOUR, 0, 0, 0);
  return monday.getTime();
}

/** The week math at `nowMs` held to the oracle (header). */
function checkAt(nowMs: number): void {
  const next = nextDigestMs(nowMs);
  const at = new Date(next);
  expect([at.getDay(), at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds()]).toEqual([
    1,
    DIGEST_HOUR,
    0,
    0,
    0,
  ]);
  expect(next).toBeGreaterThan(nowMs);
  const thisWeeks = mondayNine(nowMs, 0);
  expect(next).toBe(thisWeeks > nowMs ? thisWeeks : mondayNine(nowMs, 1));

  const week = lastWeek(nowMs);
  const thisMonday = dayStart(nowMs, -sinceMonday(nowMs));
  expect(week.toMs).toBe(thisMonday);
  expect(week.fromMs).toBe(dayStart(thisMonday, -7));
  expect(week.week).toBe(localDate(new Date(week.fromMs)));
  expect(week.toMs - week.fromMs).toBeGreaterThanOrEqual(167 * HOUR);
  expect(week.toMs - week.fromMs).toBeLessThanOrEqual(169 * HOUR);

  const days = weekDays(week);
  expect(days.map(({ startMs }) => sinceMonday(startMs))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  days.forEach((day, index) => {
    expect(day.startMs).toBe(dayStart(week.fromMs, index));
    expect(day.endMs).toBe(dayStart(week.fromMs, index + 1));
    expect(day.date).toBe(localDate(new Date(day.startMs)));
  });
  expect(days.at(-1)?.endMs).toBe(week.toMs);
}

/** The instants in 2026 and 2027 at which the zone's offset changes, found hour by hour, then to the minute. */
function clockChanges(): number[] {
  const changes: number[] = [];
  for (let at = START; at < END; at += HOUR) {
    if (offsetAt(at) === offsetAt(at + HOUR)) continue;
    let low = at;
    let high = at + HOUR;
    while (high - low > 60_000) {
      const mid = low + Math.floor((high - low) / 2 / 60_000) * 60_000;
      if (offsetAt(mid) === offsetAt(low)) low = mid;
      else high = mid;
    }
    changes.push(high);
  }
  return changes;
}

describe.each(ZONES)('the digest weeks in %s', (zone, january, july) => {
  it('hold the oracle over 1,000 random instants and at each clock change of 2026 and 2027', () => {
    useZone(zone);
    try {
      expect([offsetAt(Date.UTC(2026, 0, 15)), offsetAt(Date.UTC(2026, 6, 15))]).toEqual([january, july]);
      fc.assert(
        fc.property(fc.integer({ min: START, max: END }), (nowMs) => {
          checkAt(nowMs);
        }),
        RUNS,
      );
      const changes = clockChanges();
      expect(changes.length).toBe(january === july ? 0 : 4);
      for (const change of changes) {
        // Around the change, and a week on, when the digest's week holds the day of the change.
        for (const nowMs of [change - 1, change, change + HOUR, change + 7 * 24 * HOUR]) checkAt(nowMs);
      }
    } finally {
      useZone(HOST_ZONE);
    }
  }, 120_000);
});
