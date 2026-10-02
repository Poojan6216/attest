/**
 * Task 1.1 — times (docs/grading.md §11, §4.1). Core never reads a clock or a time-zone database: the zone is an
 * injected `offsetAt`. These tests use a US-Eastern rule (DST from the second Sunday of March 02:00 to the first
 * Sunday of November 02:00) written with UTC methods only, so they pass under any host TZ (`pnpm test:tz`).
 * 2026: DST starts Sun 8 Mar (02:00 EST → 03:00 EDT), ends Sun 1 Nov (02:00 EDT → 01:00 EST). 1 Oct 2026 is a
 * Thursday.
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
import { wallToInstant } from '../../../src/core/normalize-time';

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

describe('instantMs()', () => {
  const at = Date.UTC(2026, 9, 6, 18, 2);
  it.each([
    ['2026-10-06T14:02:00-04:00', at],
    ['2026-10-06T18:02:00Z', at],
    ['2026-10-06T18:02:00+00:00', at],
    ['2026-10-06T18:02:00-00:00', at],
    ['2026-10-06T23:32:00+05:30', at],
    ['2026-10-06T18:02:00.5Z', at + 500],
    ['2026-10-06T18:02:00.123456789Z', at + 123], // sub-millisecond digits truncate
    ['2024-02-29T00:00:00Z', Date.UTC(2024, 1, 29)],
    ['2000-02-29T12:00:00+23:59', Date.UTC(2000, 1, 29, 12) - (23 * 60 + 59) * 60_000],
    ['0001-01-01T00:00:00Z', -62_135_596_800_000], // Date.UTC would read year 1 as 1901
    ['9999-12-31T23:59:59.999Z', 253_402_300_799_999],
  ])('%j', (iso, expected) => {
    expect(instantMs(iso)).toBe(expected);
  });

  it.each([
    ['2026-10-06T14:02:00'], // no offset: local time (Hard Rule 4)
    ['2026-10-06T14:02-04:00'], // no seconds (the IsoTs schema requires them)
    ['2026-10-06 14:02:00Z'],
    ['2026-10-06t14:02:00z'],
    ['2026-02-29T00:00:00Z'],
    ['2026-13-01T00:00:00Z'],
    ['2026-04-31T00:00:00Z'],
    ['2026-10-06T24:00:00Z'],
    ['2026-10-06T14:60:00Z'],
    ['2026-10-06T14:02:60Z'], // leap seconds are not representable
    ['2026-10-06T14:02:00+24:00'],
    ['2026-10-06T14:02:00+04:60'],
    ['2026-10-06T14:02:00+0400'],
    ['2026-10-06T14:02:00.Z'],
    ['+02026-10-06T14:02:00Z'],
    ['1 Oct 2026'],
    [''],
  ])('%j throws invalid_iso', (iso) => {
    expectError(() => instantMs(iso), 'invalid_iso');
  });
});

describe('isoWithOffset()', () => {
  const at = Date.UTC(2026, 9, 6, 18, 2);
  it.each([
    [at, -240, '2026-10-06T14:02:00-04:00'],
    [at, 0, '2026-10-06T18:02:00+00:00'],
    [at, -0, '2026-10-06T18:02:00+00:00'],
    [at + 5, 330, '2026-10-06T23:32:00.005+05:30'],
    [at, -570, '2026-10-06T08:32:00-09:30'],
    [at, 840, '2026-10-07T08:02:00+14:00'],
    [0, 0, '1970-01-01T00:00:00+00:00'],
    [-1, 0, '1969-12-31T23:59:59.999+00:00'],
    [Date.UTC(2026, 0, 1, 3), -300, '2025-12-31T22:00:00-05:00'],
  ])('(%d, %d) \u2192 %j', (epochMs, offset, expected) => {
    expect(isoWithOffset(epochMs, offset)).toBe(expected);
    expect(instantMs(expected)).toBe(epochMs);
  });

  it.each([
    [at, 1440, 'invalid_offset'],
    [at, -1440, 'invalid_offset'],
    [at, 1.5, 'invalid_offset'],
    [at, Number.NaN, 'invalid_offset'],
    [Number.NaN, 0, 'invalid_instant'],
    [1.5, 0, 'invalid_instant'],
    [Date.UTC(10_000, 0, 1), 0, 'invalid_instant'],
    [Date.UTC(-1, 11, 31), 0, 'invalid_instant'], // year -1
    [8.64e15 + 1, 0, 'invalid_instant'],
  ])('(%d, %d) throws %s', (epochMs, offset, code) => {
    expectError(() => isoWithOffset(epochMs, offset), code);
  });
});

describe('wallToInstant(): DST disambiguation', () => {
  const wall = (month: number, day: number, hour: number, minute: number) =>
    Date.UTC(2026, month, day, hour, minute);
  it.each([
    ['an ordinary summer time', wall(9, 1, 14, 3), Date.UTC(2026, 9, 1, 18, 3), true],
    ['an ordinary winter time', wall(0, 15, 9, 0), Date.UTC(2026, 0, 15, 14, 0), true],
    ['just before the spring gap', wall(2, 8, 1, 59), Date.UTC(2026, 2, 8, 6, 59), true],
    [
      'inside the spring gap: shifted forward (02:30 \u2192 03:30 EDT)',
      wall(2, 8, 2, 30),
      Date.UTC(2026, 2, 8, 7, 30),
      false,
    ],
    ['just after the spring gap', wall(2, 8, 3, 0), Date.UTC(2026, 2, 8, 7, 0), true],
    [
      'the repeated hour in autumn: the earlier (EDT) instant',
      wall(10, 1, 1, 30),
      Date.UTC(2026, 10, 1, 5, 30),
      false,
    ],
    ['just after the repeated hour', wall(10, 1, 2, 0), Date.UTC(2026, 10, 1, 7, 0), true],
  ])('%s', (_label, wallMs, epochMs, exact) => {
    expect(wallToInstant(wallMs, usEastern)).toEqual({ epochMs, exact });
  });

  it('fails loudly when the injected offset function returns an impossible offset', () => {
    expectError(() => wallToInstant(0, () => 24 * 60), 'invalid_offset');
    expectError(() => wallToInstant(0, () => 0.5), 'invalid_offset');
  });
});

const THU_15 = '2026-10-01T15:00:00-04:00';
const THU_0030 = '2026-10-01T00:30:00-04:00';

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
  ['5 min ago', '2026-10-01T15:00:30-04:00', '2026-10-01T14:54:30-04:00', 'hour'],
  ['5 min ago', '2026-10-01T00:03:00-04:00', '2026-09-30T23:57:00-04:00', 'minute'],
  ['5 min ago', '2026-10-01T00:03:30-04:00', '2026-09-30T23:57:30-04:00', 'hour'],
  ['an hour ago', THU_15, '2026-10-01T13:00:00-04:00', 'hour'],
  ['2 hours ago', THU_15, '2026-10-01T12:00:00-04:00', 'hour'],
  ['2 hours ago', '2026-10-01T15:30:00-04:00', '2026-10-01T12:30:00-04:00', 'day'],
  ['2h ago', '2026-10-01T15:30:00-04:00', '2026-10-01T12:30:00-04:00', 'day'],
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
  ['1 hour ago', '2026-11-01T01:30:00-05:00', '2026-11-01T00:30:00-04:00', 'day'],
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
];

describe('resolveRelative() \u2014 US Eastern', () => {
  it.each(US_EASTERN_ROWS)('%j at %s \u2192 %s (%s)', (text, referenceIso, iso, precision) => {
    expect(resolveRelative(text, { referenceIso, offsetAt: usEastern })).toEqual({ iso, precision });
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
    ).toEqual({
      iso: '2026-09-30T22:30:00-04:00',
      precision: 'day',
    });
  });

  it('a nonexistent local midnight resolves to the first instant of that day', () => {
    expect(
      resolveRelative('Yesterday', { referenceIso: '2026-03-09T12:00:00+01:00', offsetAt: midnightGapZone }),
    ).toEqual({
      iso: '2026-03-08T01:00:00+01:00',
      precision: 'day',
    });
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

  it('a month-day that has not happened yet in year 0 has no earlier year to fall back to', () => {
    const context = { referenceIso: '0000-01-01T12:00:00+00:00', offsetAt: () => 0 };
    expect(resolveRelative('Dec 31', context)).toBeNull();
    expect(resolveRelative('Jan 1', context)).toEqual({ iso: '0000-01-01T00:00:00+00:00', precision: 'day' });
  });

  it('does not depend on the offset written in referenceIso, only on the instant', () => {
    const utc = resolveRelative('Yesterday', { referenceIso: '2026-10-01T04:30:00Z', offsetAt: usEastern });
    expect(utc).toEqual(resolveRelative('Yesterday', { referenceIso: THU_0030, offsetAt: usEastern }));
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
  it.each(OTHER_ZONE_ROWS)('%j at %s \u2192 %s', (text, referenceIso, offsetAt, iso, precision) => {
    expect(resolveRelative(text, { referenceIso, offsetAt })).toEqual({ iso, precision });
  });

  it('checks the reference before refusing unreadable text', () => {
    expectError(
      () => resolveRelative('\u202E00:21', { referenceIso: '2026-10-01T15:00:00', offsetAt: usEastern }),
      'invalid_iso',
    );
  });
});
