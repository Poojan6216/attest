/**
 * Task 1.1 — instants and wall clocks (docs/grading.md §11, §4.1); vendor-relative text is in
 * normalize-relative.spec.ts. Core never reads a clock or a time-zone database: the zone is an
 * injected `offsetAt`. These tests use a US-Eastern rule (DST from the second Sunday of March 02:00 to the first
 * Sunday of November 02:00) written with UTC methods only, so they pass under any host TZ (`pnpm test:tz`).
 * 2026: DST starts Sun 8 Mar (02:00 EST → 03:00 EDT), ends Sun 1 Nov (02:00 EDT → 01:00 EST). 1 Oct 2026 is a
 * Thursday.
 */
import { describe, expect, it } from 'vitest';

import { instantMs, isoWithOffset, NormalizeError, type OffsetAt } from '../../../src/core/normalize';
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
