/**
 * Task 1.1 + v1.2 — vendor-relative times (docs/grading.md §11, §4.1). `resolveRelative` returns the claim unit
 * that contains the text's meaning, as its start and end instants and its precision, so an adapter can set
 * `claimedAt`, `claimedAtEnd` and `claimedAtPrecision`. A day runs from one local midnight to the next (23 or
 * 25 hours on a DST change). The zone is an injected `offsetAt`: these tests use a US-Eastern rule (DST from
 * the second Sunday of March 02:00 to the first Sunday of November 02:00) written with UTC methods only, so
 * they pass under any host TZ (`pnpm test:tz`). 2026: DST starts Sun 8 Mar (02:00 EST → 03:00 EDT), ends
 * Sun 1 Nov (02:00 EDT → 01:00 EST). 1 Oct 2026 is a Thursday.
 */
import { describe, expect, it } from 'vitest';

import {
  instantMs,
  isoWithOffset,
  NormalizeError,
  type OffsetAt,
  resolveRelative,
  type TimePrecision,
} from '../../../src/core/normalize';

/** America/New_York since 2007, from UTC fields only. */
const usEastern: OffsetAt = (epochMs) => {
  const year = new Date(epochMs).getUTCFullYear();
  const firstSunday = (month: number): number =>
    1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7);
  const dstStart = Date.UTC(year, 2, firstSunday(2) + 7, 7); // 02:00 EST = 07:00Z
  const dstEnd = Date.UTC(year, 10, firstSunday(10), 6); // 02:00 EDT = 06:00Z
  return epochMs >= dstStart && epochMs < dstEnd ? -240 : -300;
};

/** A zone whose clocks jump from 00:00 to 01:00 on 8 Mar 2026: that local midnight never happens. */
const MIDNIGHT_GAP = Date.UTC(2026, 2, 8, 0);
const midnightGapZone: OffsetAt = (epochMs) => (epochMs >= MIDNIGHT_GAP ? 60 : 0);

function expectError(run: () => unknown, code: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NormalizeError);
  expect((caught as NormalizeError).code).toBe(code);
}

const THU_15 = '2026-10-01T15:00:00-04:00';
const THU_0030 = '2026-10-01T00:30:00-04:00';
const MINUTE = 60_000;
const HOUR = 3_600_000;

/**
 * The expected end of the unit starting at `start`, computed without the module under test: + 1 min or + 1 h
 * written in the zone's offset at that instant, or for a day the first instant (searched minute by minute)
 * whose local date is the next day, written in the offset in which it reads 00:00.
 */
function unitEnd(start: string, precision: TimePrecision, zone: OffsetAt): string {
  const startMs = instantMs(start);
  if (precision !== 'day') {
    const endMs = startMs + (precision === 'minute' ? MINUTE : HOUR);
    return isoWithOffset(endMs, zone(endMs));
  }
  const [, sign = '+', hh = '0', mm = '0'] = /([+-])(\d{2}):(\d{2})$/.exec(start) ?? [];
  const writtenOffsetMs = (sign === '-' ? -1 : 1) * (Number(hh) * HOUR + Number(mm) * MINUTE);
  const local = new Date(startMs + writtenOffsetMs);
  const nextMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  const localDayStart = (ms: number): number => {
    const wall = new Date(ms + zone(ms) * MINUTE);
    return Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  };
  let endMs = startMs + 20 * HOUR;
  while (localDayStart(endMs) < nextMidnight) endMs += MINUTE;
  return isoWithOffset(endMs, (nextMidnight - endMs) / MINUTE);
}

/** The full expected result for a row: its start, the unit's end and its precision. */
function unit(start: string, precision: TimePrecision, zone: OffsetAt) {
  return { start, end: unitEnd(start, precision, zone), precision };
}

const US_EASTERN_ROWS: [string, string, string, TimePrecision][] = [
  // Clock only: today, unless that is more than a displayed minute after the reference.
  ['2:03 PM', THU_15, '2026-10-01T14:03:00-04:00', 'minute'],
  ['2:03 p.m.', THU_15, '2026-10-01T14:03:00-04:00', 'minute'],
  ['2:03\u202FPM', THU_15, '2026-10-01T14:03:00-04:00', 'minute'], // Chrome's narrow NBSP before PM
  ['14:03', THU_15, '2026-10-01T14:03:00-04:00', 'minute'],
  ['12:00 AM', THU_15, '2026-10-01T00:00:00-04:00', 'minute'],
  ['12:00 PM', THU_15, '2026-10-01T12:00:00-04:00', 'minute'],
  ['2:04 PM', '2026-10-01T14:03:30-04:00', '2026-10-01T14:04:00-04:00', 'minute'], // clock skew tolerated
  ['2:05 PM', '2026-10-01T14:03:30-04:00', '2026-09-30T14:05:00-04:00', 'minute'],
  // Midnight: a late-evening clock read just after midnight is last night.
  ['11:58 PM', THU_0030, '2026-09-30T23:58:00-04:00', 'minute'],
  ['12:10 AM', THU_0030, '2026-10-01T00:10:00-04:00', 'minute'],
  // "Yesterday" at 00:30 is the calendar day before, not 24 hours before.
  ['Yesterday', THU_0030, '2026-09-30T00:00:00-04:00', 'day'],
  ['Yesterday, 11:58 PM', THU_0030, '2026-09-30T23:58:00-04:00', 'minute'],
  ['yesterday at 2:03 pm', THU_15, '2026-09-30T14:03:00-04:00', 'minute'],
  ['Today', THU_15, '2026-10-01T00:00:00-04:00', 'day'],
  ['Today, 9:15 AM', THU_15, '2026-10-01T09:15:00-04:00', 'minute'],
  // Weekdays: the most recent such day strictly before today.
  ['Wednesday', THU_15, '2026-09-30T00:00:00-04:00', 'day'],
  ['Fri', THU_15, '2026-09-25T00:00:00-04:00', 'day'],
  ['Thu', THU_15, '2026-09-24T00:00:00-04:00', 'day'],
  ['Tues.', THU_15, '2026-09-29T00:00:00-04:00', 'day'],
  ['Mon 9:00 AM', THU_15, '2026-09-28T09:00:00-04:00', 'minute'],
  // Month-day: the latest such date not after the reference date.
  ['Oct 1', THU_15, '2026-10-01T00:00:00-04:00', 'day'],
  ['1 Oct', THU_15, '2026-10-01T00:00:00-04:00', 'day'],
  ['October 1', THU_15, '2026-10-01T00:00:00-04:00', 'day'],
  ['Oct 2', THU_15, '2025-10-02T00:00:00-04:00', 'day'],
  ['Sept 30', THU_15, '2026-09-30T00:00:00-04:00', 'day'],
  ['Jan 15', THU_15, '2026-01-15T00:00:00-05:00', 'day'], // winter offset on that date
  ['Feb 29', THU_15, '2024-02-29T00:00:00-05:00', 'day'],
  ['Oct 1, 2026', THU_15, '2026-10-01T00:00:00-04:00', 'day'],
  ['1 Oct 2026', THU_15, '2026-10-01T00:00:00-04:00', 'day'],
  ['Dec 25, 2026', THU_15, '2026-12-25T00:00:00-05:00', 'day'], // an explicit year may be in the future
  ['Thu, Oct 1, 2026, 2:03\u202FPM', '2026-10-02T15:00:00-04:00', '2026-10-01T14:03:00-04:00', 'minute'],
  // "N units ago": [ref − (N+1)·unit, ref − N·unit], at the finest aligned unit containing it.
  ['5 min ago', THU_15, '2026-10-01T14:54:00-04:00', 'minute'],
  ['5 min ago', '2026-10-01T15:00:30-04:00', '2026-10-01T14:00:00-04:00', 'hour'], // [14:54:30, 14:55:30]
  ['5 min ago', '2026-10-01T00:03:00-04:00', '2026-09-30T23:57:00-04:00', 'minute'],
  ['5 min ago', '2026-10-01T00:03:30-04:00', '2026-09-30T23:00:00-04:00', 'hour'], // [23:57:30, 23:58:30]
  ['an hour ago', THU_15, '2026-10-01T13:00:00-04:00', 'hour'],
  ['2 hours ago', THU_15, '2026-10-01T12:00:00-04:00', 'hour'],
  ['2 hours ago', '2026-10-01T15:30:00-04:00', '2026-10-01T00:00:00-04:00', 'day'], // [12:30, 13:30]
  ['2h ago', '2026-10-01T15:30:00-04:00', '2026-10-01T00:00:00-04:00', 'day'],
  ['3 days ago', THU_15, '2026-09-28T00:00:00-04:00', 'day'],
  ['1 day ago', THU_0030, '2026-09-30T00:00:00-04:00', 'day'],
  // DST: elapsed time, not wall time. 03:00 EST on 1 Nov minus 2–3 h is 01:00–02:00 EDT.
  ['2 hours ago', '2026-11-01T03:00:00-05:00', '2026-11-01T01:00:00-04:00', 'hour'],
  // DST: a clock time that occurs twice or never does not name one instant; widened to its day.
  ['1:30 AM', '2026-11-01T12:00:00-05:00', '2026-11-01T00:00:00-04:00', 'day'],
  ['2:30 AM', '2026-03-08T12:00:00-04:00', '2026-03-08T00:00:00-05:00', 'day'],
  ['1:59 AM', '2026-03-08T12:00:00-04:00', '2026-03-08T01:59:00-05:00', 'minute'],
  ['3:00 AM', '2026-03-08T12:00:00-04:00', '2026-03-08T03:00:00-04:00', 'minute'],
  ['2:30 AM', '2026-11-01T12:00:00-05:00', '2026-11-01T02:30:00-05:00', 'minute'],
  ['Yesterday', '2026-03-08T12:00:00-04:00', '2026-03-07T00:00:00-05:00', 'day'],
  ['Yesterday, 11:00 PM', '2026-11-01T12:00:00-05:00', '2026-10-31T23:00:00-04:00', 'minute'],
  // DST and midnight together: a stale page, the day after a change, and both passes of the repeated hour.
  ['Yesterday', '2026-03-09T00:30:00-04:00', '2026-03-08T00:00:00-05:00', 'day'],
  ['Yesterday, 2:30 AM', '2026-03-09T00:30:00-04:00', '2026-03-08T00:00:00-05:00', 'day'],
  ['11:58 PM', '2026-11-01T00:30:00-04:00', '2026-10-31T23:58:00-04:00', 'minute'],
  ['2:30 AM', '2026-03-08T03:40:00-04:00', '2026-03-08T00:00:00-05:00', 'day'],
  ['2:30 AM', '2026-03-08T03:10:00-04:00', '2026-03-07T02:30:00-05:00', 'minute'], // today's 2:30 is ahead
  ['1:45 AM', '2026-11-01T01:30:00-05:00', '2026-11-01T00:00:00-04:00', 'day'], // second pass: 1:45 was today
  ['1:45 AM', '2026-11-01T01:30:00-04:00', '2026-10-31T01:45:00-04:00', 'minute'], // first pass: not yet
  ['60 min ago', '2026-11-01T01:30:00-05:00', '2026-11-01T01:29:00-04:00', 'minute'],
  ['1 hour ago', '2026-11-01T01:30:00-05:00', '2026-11-01T00:00:00-04:00', 'day'], // 00:30–01:30 EDT
  ['Sun', '2026-11-02T12:00:00-05:00', '2026-11-01T00:00:00-04:00', 'day'],
];

const UNREADABLE: [string][] = [
  [''],
  ['tomorrow'],
  ['next week'],
  ['5 years ago'],
  ['2:60 PM'],
  ['13:03 PM'],
  ['0:30 AM'],
  ['24:00'],
  ['2:03:15 PM'],
  ['Oct 32'],
  ['Feb 30'],
  ['Feb 29, 2026'],
  ['Fri, Oct 1, 2026'], // 1 Oct 2026 is a Thursday
  ['Oct'],
  ['Smarch 1'],
  ['at 2:03 PM'],
  ['99999999999999999 days ago'], // not a safe integer
  ['999999999999 min ago'], // before the start of Date
  ['3000000 days ago'], // a negative year cannot be written as an IsoTs
  ['9999999999 min ago'],
  // Text that displays differently from how it is stored or folded is not read.
  ['5\u00B2 min ago'], // NFKC would read "52 min ago"
  ['2:0\u00B3 PM'], // NFKC would read "2:03 PM"
  ['\u202E00:21\u202C'], // RLO: shows as "12:00", stored as "00:21"
  ['\u202Eyadretsey\u202C'],
  ['\u202DYesterday\u202C'],
  ['\u202B00:21\u202C'], // v1.3: RLE, an embedding, is refused like an override
  ['\u202AYesterday\u202C'], // LRE
];

describe('resolveRelative() \u2014 US Eastern', () => {
  it.each(US_EASTERN_ROWS)('%j at %s \u2192 %s (%s)', (text, referenceIso, start, precision) => {
    expect(resolveRelative(text, { referenceIso, offsetAt: usEastern })).toEqual(
      unit(start, precision, usEastern),
    );
  });

  it.each(UNREADABLE)('%j \u2192 null', (text) => {
    expect(resolveRelative(text, { referenceIso: THU_15, offsetAt: usEastern })).toBeNull();
  });

  it('returns null when an "ago" range straddles local midnight (no single day contains it)', () => {
    // 1–2 hours before 01:30 is 23:30–00:30: no single local day contains it.
    expect(
      resolveRelative('1 hour ago', { referenceIso: '2026-10-01T01:30:00-04:00', offsetAt: usEastern }),
    ).toBeNull();
    expect(
      resolveRelative('2 hours ago', { referenceIso: '2026-10-01T01:30:00-04:00', offsetAt: usEastern }),
    ).toEqual({ start: '2026-09-30T00:00:00-04:00', end: '2026-10-01T00:00:00-04:00', precision: 'day' });
  });

  it('does not depend on the offset written in referenceIso, only on the instant', () => {
    const utc = resolveRelative('Yesterday', { referenceIso: '2026-10-01T04:30:00Z', offsetAt: usEastern });
    expect(utc).toEqual(resolveRelative('Yesterday', { referenceIso: THU_0030, offsetAt: usEastern }));
  });

  it('rejects a bad reference and an impossible injected offset loudly', () => {
    expectError(
      () => resolveRelative('2:03 PM', { referenceIso: '2026-10-01T15:00:00', offsetAt: usEastern }),
      'invalid_iso',
    );
    expectError(
      () => resolveRelative('2:03 PM', { referenceIso: THU_15, offsetAt: () => 9_999 }),
      'invalid_offset',
    );
    // An injected zone that is valid at the reference but broken where the text lands still fails loudly.
    const brokenAwayFromReference: OffsetAt = (epochMs) => (epochMs === instantMs(THU_15) ? -240 : 9_999);
    expectError(
      () => resolveRelative('Yesterday', { referenceIso: THU_15, offsetAt: brokenAwayFromReference }),
      'invalid_offset',
    );
  });
});

/** Samoa crossed the date line: 29 Dec 2011 24:00 (−10:00) was followed by 31 Dec 00:00 (+14:00). */
const SAMOA_JUMP = Date.UTC(2011, 11, 30, 10);
const samoaZone: OffsetAt = (epochMs) => (epochMs < SAMOA_JUMP ? -600 : 840);

describe('resolveRelative(): a skipped day, a skipped midnight and the year limits', () => {
  it('a local date the zone skipped entirely is no claim unit: null, never a unit with end = start', () => {
    const context = { referenceIso: '2012-01-02T12:00:00+14:00', offsetAt: samoaZone };
    expect(resolveRelative('Dec 30, 2011', context)).toBeNull();
    expect(resolveRelative('3 days ago', context)).toBeNull();
    // The days either side are whole 24-hour days, each boundary written in the offset in which it reads 00:00.
    expect(resolveRelative('Dec 29, 2011', context)).toEqual({
      start: '2011-12-29T00:00:00-10:00',
      end: '2011-12-30T00:00:00-10:00',
      precision: 'day',
    });
    expect(resolveRelative('Dec 31, 2011', context)).toEqual({
      start: '2011-12-31T00:00:00+14:00',
      end: '2012-01-01T00:00:00+14:00',
      precision: 'day',
    });
  });

  it('a nonexistent local midnight resolves to the first instant of that day, written as 00:00', () => {
    // 00:00Z is when clocks jump from 00:00 (+00:00) to 01:00 (+01:00): the day starts there and is 23 h long.
    expect(
      resolveRelative('Yesterday', { referenceIso: '2026-03-09T12:00:00+01:00', offsetAt: midnightGapZone }),
    ).toEqual({ start: '2026-03-08T00:00:00+00:00', end: '2026-03-09T00:00:00+01:00', precision: 'day' });
  });

  it('a month-day that has not happened yet in year 0 has no earlier year to fall back to', () => {
    const context = { referenceIso: '0000-01-01T12:00:00+00:00', offsetAt: () => 0 };
    expect(resolveRelative('Dec 31', context)).toBeNull();
    expect(resolveRelative('Jan 1', context)).toEqual({
      start: '0000-01-01T00:00:00+00:00',
      end: '0000-01-02T00:00:00+00:00',
      precision: 'day',
    });
    // The last day that can be written: its end (year 10000) cannot, so it is not claimed.
    const lastDay = { referenceIso: '9999-12-31T12:00:00+00:00', offsetAt: () => 0 };
    expect(resolveRelative('Today', lastDay)).toBeNull();
    expect(resolveRelative('Today, 11:59 PM', lastDay)).toBeNull(); // ends at 10000-01-01T00:00
    expect(resolveRelative('11:58 AM', lastDay)).toEqual({
      start: '9999-12-31T11:58:00+00:00',
      end: '9999-12-31T11:59:00+00:00',
      precision: 'minute',
    });
  });
});

/** Clocks go back at local midnight (−03:00 → −04:00 on 5 Apr 2026): 23:00–23:59 on 4 Apr happens twice. */
const MIDNIGHT_FALL_BACK = Date.UTC(2026, 3, 5, 3);
const midnightFallBackZone: OffsetAt = (epochMs) => (epochMs < MIDNIGHT_FALL_BACK ? -180 : -240);
/** A 30-minute DST change (+11:00 → +10:30 at 02:00 local on 5 Apr 2026): 01:30–01:59 happens twice. */
const HALF_HOUR_FALL_BACK = Date.UTC(2026, 3, 4, 15);
const halfHourZone: OffsetAt = (epochMs) => (epochMs < HALF_HOUR_FALL_BACK ? 660 : 630);
const quarterHourZone: OffsetAt = () => 345; // +05:45 all year

const OTHER_ZONE_ROWS: [string, string, OffsetAt, string, TimePrecision][] = [
  ['11:30 PM', '2026-04-05T00:30:00-04:00', midnightFallBackZone, '2026-04-04T00:00:00-03:00', 'day'],
  [
    'Yesterday, 11:30 PM',
    '2026-04-05T12:00:00-04:00',
    midnightFallBackZone,
    '2026-04-04T00:00:00-03:00',
    'day',
  ],
  [
    'Yesterday, 10:30 PM',
    '2026-04-05T12:00:00-04:00',
    midnightFallBackZone,
    '2026-04-04T22:30:00-03:00',
    'minute',
  ],
  ['Today', '2026-04-05T12:00:00-04:00', midnightFallBackZone, '2026-04-05T00:00:00-04:00', 'day'],
  ['1:45 AM', '2026-04-05T12:00:00+10:30', halfHourZone, '2026-04-05T00:00:00+11:00', 'day'],
  ['1:15 AM', '2026-04-05T12:00:00+10:30', halfHourZone, '2026-04-05T01:15:00+11:00', 'minute'],
  ['2:15 AM', '2026-04-05T12:00:00+10:30', halfHourZone, '2026-04-05T02:15:00+10:30', 'minute'],
  ['2:03 PM', '2026-10-01T15:00:00+05:45', quarterHourZone, '2026-10-01T14:03:00+05:45', 'minute'],
  ['2 hours ago', '2026-10-01T15:00:00+05:45', quarterHourZone, '2026-10-01T12:00:00+05:45', 'hour'],
  ['Yesterday', '2026-10-01T00:10:00+05:45', quarterHourZone, '2026-09-30T00:00:00+05:45', 'day'],
];

describe('resolveRelative() \u2014 other zones (midnight fall-back, 30-minute DST, +05:45)', () => {
  it.each(OTHER_ZONE_ROWS)('%j at %s \u2192 %s', (text, referenceIso, offsetAt, start, precision) => {
    expect(resolveRelative(text, { referenceIso, offsetAt })).toEqual(unit(start, precision, offsetAt));
  });

  it('an hour is aligned in the offset at the range start, even when the zone changed during that hour', () => {
    // 5–6 min before 01:46:30 (+10:30) is 01:40:30–01:41:30: hour 01:00–02:00 in +10:30, i.e. 14:30Z–15:30Z,
    // although at 14:30Z the clocks still read +11:00. Written in +10:30, the start truncates to itself.
    expect(
      resolveRelative('5 min ago', { referenceIso: '2026-04-05T01:46:30+10:30', offsetAt: halfHourZone }),
    ).toEqual({ start: '2026-04-05T01:00:00+10:30', end: '2026-04-05T02:00:00+10:30', precision: 'hour' });
  });

  it('checks the reference before refusing unreadable text', () => {
    expectError(
      () => resolveRelative('\u202E00:21', { referenceIso: '2026-10-01T15:00:00', offsetAt: usEastern }),
      'invalid_iso',
    );
  });
});

/** [text, reference, start, end, hours in the unit]: written by hand from the zone rules, not computed. */
const DST_DAYS: [string, string, string, string, number][] = [
  // Spring forward, Sun 8 Mar 2026: 02:00 EST → 03:00 EDT, so the local day is 23 hours long.
  ['Yesterday', '2026-03-09T12:00:00-04:00', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
  ['Mar 8', '2026-03-09T12:00:00-04:00', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
  ['Sun', '2026-03-10T12:00:00-04:00', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
  ['2:30 AM', '2026-03-08T12:00:00-04:00', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23],
  // Fall back, Sun 1 Nov 2026: 02:00 EDT → 01:00 EST, so the local day is 25 hours long.
  ['Yesterday', '2026-11-02T08:00:00-05:00', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
  ['Nov 1', '2026-11-02T08:00:00-05:00', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
  ['Sun', '2026-11-02T12:00:00-05:00', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
  ['1:30 AM', '2026-11-01T12:00:00-05:00', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
  ['1 day ago', '2026-11-02T00:30:00-05:00', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25],
  // The days either side are 24 hours, in their own offsets.
  ['Sat', '2026-11-02T12:00:00-05:00', '2026-10-31T00:00:00-04:00', '2026-11-01T00:00:00-04:00', 24],
  ['Today', '2026-11-02T12:00:00-05:00', '2026-11-02T00:00:00-05:00', '2026-11-03T00:00:00-05:00', 24],
  ['Sat', '2026-03-09T12:00:00-04:00', '2026-03-07T00:00:00-05:00', '2026-03-08T00:00:00-05:00', 24],
];

describe('resolveRelative(): a day unit ends at the next local midnight (v1.2 §4.1 claimedAtEnd)', () => {
  it.each(DST_DAYS)('%j at %s → [%s, %s] (%i h)', (text, referenceIso, start, end, hours) => {
    expect(resolveRelative(text, { referenceIso, offsetAt: usEastern })).toEqual({
      start,
      end,
      precision: 'day',
    });
    expect((instantMs(end) - instantMs(start)) / HOUR).toBe(hours);
  });

  it('the last hour of the 25-hour day is inside the unit, though start + 24 h would cut it off', () => {
    const result = resolveRelative('Nov 1', {
      referenceIso: '2026-11-02T08:00:00-05:00',
      offsetAt: usEastern,
    });
    if (result === null) throw new Error('expected a day');
    const lastHour = instantMs('2026-11-01T23:30:00-05:00');
    expect(lastHour).toBeGreaterThan(instantMs(result.start) + 24 * HOUR);
    expect(lastHour).toBeLessThan(instantMs(result.end));
  });

  it('the 23-hour day ends at the next local midnight, not an hour into the next day', () => {
    const result = resolveRelative('Mar 8', {
      referenceIso: '2026-03-09T12:00:00-04:00',
      offsetAt: usEastern,
    });
    if (result === null) throw new Error('expected a day');
    const nextDayFirstHour = instantMs('2026-03-09T00:30:00-04:00');
    expect(nextDayFirstHour).toBeLessThan(instantMs(result.start) + 24 * HOUR);
    expect(nextDayFirstHour).toBeGreaterThan(instantMs(result.end));
  });
});
