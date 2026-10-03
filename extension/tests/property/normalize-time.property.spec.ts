/**
 * Task 1.1 + v1.2 time properties (fast-check, ≥ 1,000 runs each): ISO instants round-trip and agree with the
 * IsoTs schema; resolveRelative maps clock text to the right instant across DST under an injected US-Eastern
 * zone, a day unit always runs from one local midnight to the next (23–25 h), and an "N units ago" result
 * always claims an aligned unit that contains the whole range the text can mean.
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
import { trailingOffsetMinutes, wallToInstant } from '../../src/core/normalize-time';

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

/**
 * `instantMs` as the schema's own pattern defines it (the implementation before the character-code fast path):
 * the reference the fast path must equal on every string it accepts, and must leave every other string to.
 */
const REFERENCE_ISO =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d+))?(?:Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/;
function referenceInstantMs(iso: string): number {
  const fields = REFERENCE_ISO.exec(iso)?.groups;
  if (fields === undefined) throw new NormalizeError('invalid_iso');
  const [year, month, day] = [Number(fields.year), Number(fields.month), Number(fields.day)];
  const [hour, minute, second] = [Number(fields.hour), Number(fields.minute), Number(fields.second)];
  const calculator = new Date(0);
  calculator.setUTCFullYear(year, month - 1, day);
  const exists =
    calculator.getUTCFullYear() === year &&
    calculator.getUTCMonth() === month - 1 &&
    calculator.getUTCDate() === day;
  if (hour >= 24 || minute >= 60 || second >= 60 || !exists) throw new NormalizeError('invalid_iso');
  const [offsetHours, offsetMinutes] = [Number(fields.offsetHour ?? 0), Number(fields.offsetMinute ?? 0)];
  if (offsetHours >= 24 || offsetMinutes >= 60) throw new NormalizeError('invalid_iso');
  const magnitude = offsetHours * 60 + offsetMinutes;
  const offset = fields.sign === undefined ? 0 : fields.sign === '-' ? -magnitude : magnitude;
  const fraction =
    fields.fraction === undefined
      ? 0
      : Number((BigInt(fields.fraction) * 1000n) / 10n ** BigInt(fields.fraction.length));
  return calculator.getTime() + hour * HOUR + minute * MINUTE + second * 1000 + fraction - offset * MINUTE;
}

/** The outcome of a parse: the instant, or the error code. */
function outcome(parse: (iso: string) => number, iso: string): number | string {
  try {
    return parse(iso);
  } catch (error) {
    return error instanceof NormalizeError ? `NormalizeError:${error.code}` : 'other';
  }
}

const two = (n: number) => String(n).padStart(2, '0');
/** ISO-shaped text with fields at and past their limits, any fraction length, `Z` or any written offset. */
const isoShaped = fc
  .record({
    year: fc.oneof(
      fc.integer({ min: 0, max: 199 }),
      fc.integer({ min: 1900, max: 2100 }),
      fc.integer({ min: 0, max: 9999 }),
    ),
    month: fc.integer({ min: 0, max: 13 }),
    day: fc.integer({ min: 0, max: 32 }),
    hour: fc.integer({ min: 0, max: 25 }),
    minute: fc.integer({ min: 0, max: 61 }),
    second: fc.integer({ min: 0, max: 61 }),
    fraction: fc.option(
      fc.string({ unit: fc.constantFrom(...Array.from('0123456789')), minLength: 0, maxLength: 12 }),
    ),
    offset: fc.option(
      fc.tuple(fc.constantFrom('+', '-'), fc.integer({ min: 0, max: 25 }), fc.integer({ min: 0, max: 61 })),
    ),
  })
  .map(({ year, month, day, hour, minute, second, fraction, offset }) => {
    const head = `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}:${two(second)}`;
    const tail = offset === null ? 'Z' : `${offset[0]}${two(offset[1])}:${two(offset[2])}`;
    return `${head}${fraction === null ? '' : `.${fraction}`}${tail}`;
  });
/** One character of ISO-shaped text replaced, dropped or doubled (non-ASCII digits and stray punctuation too). */
const mutated = fc
  .tuple(
    isoShaped,
    fc.nat(40),
    fc.constantFrom(...Array.from('0129-:TZz+.x \u0663\uff11')),
    fc.constantFrom('replace', 'drop', 'insert'),
  )
  .map(([iso, at, unit, how]) => {
    const i = at % (iso.length + 1);
    if (how === 'drop') return iso.slice(0, i) + iso.slice(i + 1);
    return iso.slice(0, i) + unit + iso.slice(how === 'replace' ? i + 1 : i);
  });

/** The offset an ISO string ends with, read by the pattern window.ts used before the fast read (Z or none: 0). */
function referenceTrailingOffset(iso: string): number {
  const groups = /(?:Z|(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))$/.exec(iso)?.groups;
  if (groups?.sign === undefined) return 0;
  const magnitude = Number(groups.hours) * 60 + Number(groups.minutes);
  return groups.sign === '-' ? -magnitude : magnitude;
}

describe('trailingOffsetMinutes: the fast read equals the pattern wherever it answers (property)', () => {
  it('is null or the pattern reading, and answers for every timestamp instantMs accepts', () => {
    fc.assert(
      fc.property(fc.oneof(isoShaped, mutated, fc.string({ maxLength: 40 })), (iso) => {
        const fast = trailingOffsetMinutes(iso);
        if (fast !== null) expect(fast).toBe(referenceTrailingOffset(iso));
        if (outcome(instantMs, iso) !== 'NormalizeError:invalid_iso') expect(fast).not.toBeNull();
      }),
      { numRuns: 20_000 },
    );
  });
});

describe('instantMs: the fast path equals the schema-pattern definition (property)', () => {
  it('gives the same instant or the same NormalizeError on ISO-shaped and mutated text', () => {
    fc.assert(
      fc.property(fc.oneof(isoShaped, mutated, fc.string({ maxLength: 40 })), (iso) => {
        expect(outcome(instantMs, iso)).toBe(outcome(referenceInstantMs, iso));
      }),
      { numRuns: 20_000 },
    );
  });
});

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

/** Local wall-clock fields of an ISO string in its own written offset. */
function wall(iso: string): Date {
  return new Date(instantMs(iso) + offsetOf(iso) * MINUTE);
}

/**
 * The next local midnight after the local date of `epochMs`: the first minute whose local wall time reaches
 * the next date, searched hour by hour and then minute by minute (independent of the module under test).
 */
function nextLocalMidnight(epochMs: number, zone: OffsetAt): number {
  const local = new Date(epochMs + zone(epochMs) * MINUTE);
  const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  const reached = (at: number): boolean => at + zone(at) * MINUTE >= next;
  let at = Math.floor(epochMs / MINUTE) * MINUTE; // offsets are whole minutes, so a midnight is on a minute
  while (!reached(at + HOUR)) at += HOUR;
  while (!reached(at)) at += MINUTE;
  return at;
}

/** A day unit: local midnight to the next local midnight, each written in the zone's offset (no gaps here). */
function expectWholeDay(start: string, end: string): void {
  expect(offsetOf(start)).toBe(usEastern(instantMs(start)));
  expect(offsetOf(end)).toBe(usEastern(instantMs(end)));
  expect([wall(start).getUTCHours(), wall(start).getUTCMinutes()]).toEqual([0, 0]);
  expect(instantMs(end)).toBe(nextLocalMidnight(instantMs(start), usEastern));
  expect([23, 24, 25]).toContain((instantMs(end) - instantMs(start)) / HOUR);
}

describe('resolveRelative clock times (property, US Eastern)', () => {
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
        const at = instantMs(result.start);
        expect(offsetOf(result.start)).toBe(usEastern(at));
        const local = wall(result.start);
        if (result.precision === 'minute') {
          expect([local.getUTCHours(), local.getUTCMinutes()]).toEqual([hour, minute]);
          expect(instantMs(result.end)).toBe(at + MINUTE);
          expect(offsetOf(result.end)).toBe(usEastern(at + MINUTE));
          expect(at).toBeLessThanOrEqual(referenceMs + MINUTE);
          expect(at).toBeGreaterThan(referenceMs - 2 * DAY);
        } else {
          // Day precision only when that wall time occurs twice or never on that date (a DST change).
          expect(result.precision).toBe('day');
          expectWholeDay(result.start, result.end);
          const clockWall = Date.UTC(
            local.getUTCFullYear(),
            local.getUTCMonth(),
            local.getUTCDate(),
            hour,
            minute,
          );
          expect(wallToInstant(clockWall, usEastern).exact).toBe(false);
        }
      }),
      { numRuns: 3_000 },
    );
  });
});

describe('resolveRelative day units (property, US Eastern)', () => {
  it('"N days ago", weekdays and dates are whole local days, 23 to 25 hours long', () => {
    const text = fc.oneof(
      fc.nat({ max: 400 }).map((count) => `${count} days ago`),
      fc.constantFrom('Today', 'Yesterday', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'),
      fc
        .constantFrom('Mar', 'Nov', 'Oct')
        .chain((month) => fc.integer({ min: 1, max: 28 }).map((day) => `${month} ${day}`)),
    );
    fc.assert(
      fc.property(reference, text, (referenceMs, words) => {
        const referenceIso = isoWithOffset(referenceMs, usEastern(referenceMs));
        const result = resolveRelative(words, { referenceIso, offsetAt: usEastern });
        expect(result).not.toBeNull();
        if (result === null) return;
        expect(result.precision).toBe('day');
        expectWholeDay(result.start, result.end);
        expect(instantMs(result.start)).toBeLessThanOrEqual(referenceMs);
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
          // Only when not even the local day of the range start contains the range.
          expect(nextLocalMidnight(earliest, usEastern)).toBeLessThan(latest);
          return;
        }
        const start = instantMs(result.start);
        const end = instantMs(result.end);
        expect(start).toBeLessThanOrEqual(earliest);
        expect(end).toBeGreaterThanOrEqual(latest);
        if (result.precision === 'day') {
          expectWholeDay(result.start, result.end);
          return;
        }
        // A minute or an hour, aligned in its own written offset: §4.1 truncation of `start` is `start`.
        const unitMs = result.precision === 'minute' ? MINUTE : HOUR;
        expect(end - start).toBe(unitMs);
        const offsetMs = offsetOf(result.start) * MINUTE;
        expect(Math.floor((start + offsetMs) / unitMs) * unitMs - offsetMs).toBe(start);
        if (result.precision === 'hour' && size === MINUTE) {
          // The finest unit: the range did not fit the minute it starts in.
          expect(Math.floor((earliest + offsetMs) / MINUTE) * MINUTE - offsetMs + MINUTE).toBeLessThan(
            latest,
          );
        }
      }),
      { numRuns: 3_000 },
    );
  });
});
