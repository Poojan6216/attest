/**
 * Task 1.1 time properties (fast-check, ≥ 1,000 runs each): ISO instants round-trip and agree with the IsoTs
 * schema; resolveRelative maps clock text to the right instant across DST under an injected US-Eastern zone,
 * and an "N units ago" result always claims a unit that contains the whole range the text can mean.
 */
import fc from 'fast-check';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  instantMs,
  isoWithOffset,
  NormalizeError,
  type OffsetAt,
  resolveRelative,
} from '../../src/core/normalize';
import { wallToInstant } from '../../src/core/normalize-time';

const IsoTs = z.iso.datetime({ offset: true });
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** America/New_York since 2007, from UTC fields only (same rule as tests/unit/core/normalize-time.spec.ts). */
const usEastern: OffsetAt = (epochMs) => {
  const year = new Date(epochMs).getUTCFullYear();
  const firstSunday = (month: number): number =>
    1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7);
  const dstStart = Date.UTC(year, 2, firstSunday(2) + 7, 7);
  const dstEnd = Date.UTC(year, 10, firstSunday(10), 6);
  return epochMs >= dstStart && epochMs < dstEnd ? -240 : -300;
};

function offsetOf(iso: string): number {
  const match = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (match === null) throw new Error(`no offset in ${iso}`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** Year 0001-01-02 … 9999-12-30, so any offset keeps the local year four digits. */
const instant = fc.integer({ min: -62_135_510_400_000, max: 253_402_128_000_000 });
const offset = fc.integer({ min: -1_439, max: 1_439 });
/** References from 2000 to 2099 (the DST rule above is the post-2007 one, but it is a consistent zone). */
const reference = fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2099, 11, 31) });

describe('instantMs / isoWithOffset (property)', () => {
  it('round-trip any instant at any offset, and the IsoTs schema accepts every string written', () => {
    fc.assert(
      fc.property(instant, offset, (epochMs, offsetMinutes) => {
        const iso = isoWithOffset(epochMs, offsetMinutes);
        expect(instantMs(iso)).toBe(epochMs);
        expect(offsetOf(iso)).toBe(offsetMinutes);
        expect(IsoTs.safeParse(iso).success).toBe(true);
      }),
      { numRuns: 5_000 },
    );
  });

  it('instantMs accepts exactly what the IsoTs schema accepts, with the instant Date reads', () => {
    const two = (max: number) => fc.integer({ min: 0, max }).map((n) => String(n).padStart(2, '0'));
    const candidate = fc
      .record({
        year: fc.integer({ min: 0, max: 9_999 }).map((n) => String(n).padStart(4, '0')),
        month: two(13),
        day: two(32),
        hour: two(24),
        minute: two(60),
        second: two(60),
        fraction: fc.constantFrom('', '.5', '.123', '.1234567', '.'),
        zone: fc.constantFrom('Z', '+00:00', '-04:00', '+05:30', '+23:59', '+24:00', '-00:60', '', '+0400'),
      })
      .map((p) => `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.fraction}${p.zone}`);
    fc.assert(
      fc.property(candidate, (iso) => {
        const accepted = IsoTs.safeParse(iso).success;
        let parsed: number | null = null;
        try {
          parsed = instantMs(iso);
        } catch (error) {
          expect(error).toBeInstanceOf(NormalizeError);
        }
        expect(parsed !== null).toBe(accepted);
        if (parsed !== null) {
          const truncated = iso.replace(/(\.\d{3})\d+/, '$1');
          expect(parsed).toBe(new Date(truncated).getTime());
        }
      }),
      { numRuns: 5_000 },
    );
  });
});

describe('resolveRelative (property, US Eastern)', () => {
  it('a clock time resolves to that wall time today or yesterday, at the zone offset in force then', () => {
    const clock = fc.record({
      hour: fc.integer({ min: 0, max: 23 }),
      minute: fc.integer({ min: 0, max: 59 }),
      twelve: fc.boolean(),
    });
    fc.assert(
      fc.property(reference, clock, (referenceMs, { hour, minute, twelve }) => {
        const mm = String(minute).padStart(2, '0');
        const text = twelve
          ? `${hour % 12 === 0 ? 12 : hour % 12}:${mm} ${hour < 12 ? 'AM' : 'PM'}`
          : `${hour}:${mm}`;
        const referenceIso = isoWithOffset(referenceMs, usEastern(referenceMs));
        const result = resolveRelative(text, { referenceIso, offsetAt: usEastern });
        expect(result).not.toBeNull();
        if (result === null) return;
        const at = instantMs(result.iso);
        expect(offsetOf(result.iso)).toBe(usEastern(at));
        const local = new Date(at + offsetOf(result.iso) * MINUTE);
        if (result.precision === 'minute') {
          expect([local.getUTCHours(), local.getUTCMinutes()]).toEqual([hour, minute]);
          expect(at).toBeLessThanOrEqual(referenceMs + MINUTE);
          expect(at).toBeGreaterThan(referenceMs - 2 * DAY);
        } else {
          // Day precision only when that wall time occurs twice or never on that date (a DST change).
          expect(result.precision).toBe('day');
          const wall = Date.UTC(
            local.getUTCFullYear(),
            local.getUTCMonth(),
            local.getUTCDate(),
            hour,
            minute,
          );
          expect(wallToInstant(wall, usEastern).exact).toBe(false);
        }
      }),
      { numRuns: 3_000 },
    );
  });
});

describe('resolveRelative "ago" (property, US Eastern)', () => {
  it('"N min/hours ago" claims a unit that contains the whole range [ref \u2212 (N+1)\u00B7unit, ref \u2212 N\u00B7unit]', () => {
    const unit = fc.constantFrom(['min', MINUTE] as const, ['hours', HOUR] as const);
    fc.assert(
      fc.property(reference, fc.integer({ min: 0, max: 500 }), unit, (referenceMs, count, [word, size]) => {
        const referenceIso = isoWithOffset(referenceMs, usEastern(referenceMs));
        const result = resolveRelative(`${count} ${word} ago`, { referenceIso, offsetAt: usEastern });
        const earliest = referenceMs - (count + 1) * size;
        const latest = referenceMs - count * size;
        if (result === null) {
          // Only when no single local day contains the range.
          const offsetMs = usEastern(earliest) * MINUTE;
          const dayStart = Math.floor((earliest + offsetMs) / DAY) * DAY - offsetMs;
          expect(dayStart + DAY).toBeLessThan(latest);
          return;
        }
        const at = instantMs(result.iso);
        expect(at).toBe(earliest);
        const unitMs = { minute: MINUTE, hour: HOUR, day: DAY }[result.precision];
        const offsetMs = offsetOf(result.iso) * MINUTE;
        const start = Math.floor((at + offsetMs) / unitMs) * unitMs - offsetMs;
        expect(start).toBeLessThanOrEqual(earliest);
        expect(start + unitMs).toBeGreaterThanOrEqual(latest);
      }),
      { numRuns: 3_000 },
    );
  });
});
