/**
 * `upcomingIn` (src/core/normalize-upcoming.ts through normalize-relative.ts; sprint_3 3.15; docs/grading.md §4.1
 * `targetAt`; Hard Rule 5) against an oracle written out from the rules, over any claim instant, zone, day and clock
 * (Sprint 3 QA review; qa_tester rule 4: at least 1,000 examples each). tests/unit/core/normalize-upcoming.spec.ts holds
 * one zone and one month, before any change of the clocks; here the claims fall on every side of daylight-saving
 * changes, in zones whose offsets are whole, half and three-quarter hours, east and west of UTC.
 *
 * The oracle: the day is the first such weekday on or after the claim's local date, `today`, `tomorrow`, or a month and
 * day (the first on or after it; with a year, exactly that date; one no calendar has gives none), a weekday written
 * beside a date agreeing with it. The event starts at the clock on that day: none when the zone shows that wall time
 * twice or never (found by trying each offset the zone uses), none when a weekday or a date is the claim's own day
 * and the time is already past at the claim; else that instant, in the offset in force then.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MONTH_NAMES, WEEKDAY_NAMES } from '../../src/core/normalize-names';
import { upcomingIn } from '../../src/core/normalize-relative';

const RUNS = { numRuns: 2_000 };
const MINUTE = 60_000;
const DAY = 86_400_000;

interface Zone {
  readonly offsetAt: (ms: number) => number;
  /** Every offset the zone ever shows, in minutes. */
  readonly offsets: readonly number[];
  readonly changes: readonly number[];
}

/** A zone at `first` minutes east of UTC that flips between `first` and `other` at each of `changes` (UTC). */
function zone(first: number, other: number, changes: readonly number[]): Zone {
  const offsetAt = (ms: number): number =>
    changes.filter((change) => ms >= change).length % 2 === 0 ? first : other;
  return { offsetAt, offsets: first === other ? [first] : [first, other], changes };
}

const utc = (y: number, m: number, d: number, h: number, min = 0): number => Date.UTC(y, m - 1, d, h, min);
const ZONES: readonly Zone[] = [
  // New York and St John's (back an hour each autumn, forward each spring), Lord Howe (half an hour), Chatham (+12:45).
  zone(-240, -300, [utc(2026, 11, 1, 6), utc(2027, 3, 14, 7), utc(2027, 11, 7, 6), utc(2028, 3, 12, 7)]),
  zone(-150, -210, [utc(2026, 11, 1, 4, 30), utc(2027, 3, 14, 5, 30), utc(2027, 11, 7, 4, 30)]),
  zone(630, 660, [utc(2026, 10, 3, 15, 30), utc(2027, 4, 3, 15), utc(2027, 10, 2, 15, 30)]),
  zone(825, 765, [utc(2027, 4, 3, 14), utc(2027, 9, 25, 14)]),
  zone(330, 330, []),
  zone(840, 840, []),
  zone(-720, -720, []),
];

interface Civil {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

const civilOf = (ms: number): Civil => {
  const date = new Date(ms);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
};
const midnightOf = (date: Civil): number => Date.UTC(date.y, date.m - 1, date.d);
const exists = (date: Civil): boolean => {
  const back = civilOf(midnightOf(date));
  return back.y === date.y && back.m === date.m && back.d === date.d;
};
const weekdayOf = (date: Civil): number => new Date(midnightOf(date)).getUTCDay();
const compare = (a: Civil, b: Civil): number => a.y - b.y || a.m - b.m || a.d - b.d;
const localDate = (z: Zone, ms: number): Civil => civilOf(ms + z.offsetAt(ms) * MINUTE);

const two = (n: number): string => String(n).padStart(2, '0');
const offsetText = (offset: number): string =>
  `${offset < 0 ? '-' : '+'}${two(Math.floor(Math.abs(offset) / 60))}:${two(Math.abs(offset) % 60)}`;

/** What the oracle expects for `date` at `minute` past local midnight (rules in the file comment). */
function expected(
  z: Zone,
  claimMs: number,
  date: Civil | null,
  minute: number,
  named: boolean,
): string | null {
  if (date === null || !exists(date)) return null;
  const wall = midnightOf(date) + minute * MINUTE;
  const instants = z.offsets
    .filter((offset) => z.offsetAt(wall - offset * MINUTE) === offset)
    .map((offset) => wall - offset * MINUTE);
  const [at] = instants;
  if (instants.length !== 1 || at === undefined) return null;
  if (!named && compare(date, localDate(z, claimMs)) === 0 && at < claimMs) return null;
  const offset = z.offsetAt(at);
  return `${new Date(at + offset * MINUTE).toISOString().slice(0, 19)}${offsetText(offset)}`;
}

/** A claim instant: anywhere from October 2026 to April 2027, or in the eight days before a zone's change. */
const claimArb = fc
  .tuple(
    fc.integer({ min: 0, max: ZONES.length - 1 }),
    fc.boolean(),
    fc.integer({ min: 0, max: 210 * 24 * 60 }),
  )
  .map(([index, near, minutes]) => {
    const z = ZONES[index] ?? ZONES[0];
    if (z === undefined) throw new Error('no zone');
    const change = z.changes[minutes % Math.max(z.changes.length, 1)];
    const ms =
      near && change !== undefined
        ? change - (minutes % (8 * 24 * 60)) * MINUTE
        : utc(2026, 10, 1, 0) + minutes * MINUTE;
    return { z, claimMs: ms };
  });

/** A clock as logs and agents write one: 12-hour, 24-hour, with or without minutes, “noon”. */
const clockArb = fc
  .tuple(
    fc.oneof(fc.integer({ min: 0, max: 1_439 }), fc.integer({ min: 0, max: 4 * 60 - 1 })),
    fc.nat(),
    fc.boolean(),
  )
  .map(([minute, pick, upper]) => {
    const [h, m] = [Math.floor(minute / 60), minute % 60];
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const ap = h < 12 ? 'am' : 'pm';
    const meridiem = upper ? ap.toUpperCase() : ap;
    const forms = [`${h12}:${two(m)} ${meridiem}`, `${h12}:${two(m)}${meridiem}`, `${h}:${two(m)}`];
    forms.push(`${two(h)}:${two(m)}`, `${h12}:${two(m)} ${ap.charAt(0)}.m.`);
    if (m === 0) forms.push(`${h12}${meridiem}`, `${h12} ${meridiem}`);
    if (minute === 12 * 60) forms.push('noon', 'Noon');
    return { minute, text: forms[pick % forms.length] ?? forms[0] ?? '' };
  });

const cased = (word: string, kase: number): string =>
  kase === 0 ? word : kase === 1 ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

/** A name from `table[index]` as written: any of its spellings, in any case, sometimes with a dot. */
const nameArb = (table: readonly (readonly string[])[], index: fc.Arbitrary<number>) =>
  fc.tuple(index, fc.nat(), fc.integer({ min: 0, max: 2 }), fc.boolean()).map(([i, pick, kase, dot]) => {
    const names = table[i] ?? [];
    return { index: i, text: `${cased(names[pick % names.length] ?? '', kase)}${dot ? '.' : ''}` };
  });

const sentence = fc.tuple(
  fc.constantFrom(
    'Created "Sync" for',
    'Booked the dentist for',
    'Scheduled it',
    'Created calendar event "Q3 review"',
  ),
  fc.constantFrom(' at ', ' ', ', ', ', at '),
  fc.constantFrom('', ' with the team', '.'),
);

describe('upcomingIn: a weekday and a clock (property)', () => {
  it('is the oracle’s instant in every zone, across every daylight-saving change, or none exactly when it says', () => {
    const tally = { found: 0, none: 0 };
    fc.assert(
      fc.property(
        claimArb,
        nameArb(WEEKDAY_NAMES, fc.integer({ min: 0, max: 6 })),
        clockArb,
        sentence,
        (claim, day, clock, [lead, join, tail]) => {
          const { z, claimMs } = claim;
          const today = localDate(z, claimMs);
          const date = civilOf(midnightOf(today) + ((day.index - weekdayOf(today) + 7) % 7) * DAY);
          const text = `${lead} ${day.text}${join}${clock.text}${tail}`;
          const found = upcomingIn(text, {
            referenceIso: new Date(claimMs).toISOString(),
            offsetAt: z.offsetAt,
          });
          expect(found, text).toBe(expected(z, claimMs, date, clock.minute, false));
          tally[found === null ? 'none' : 'found'] += 1;
        },
      ),
      RUNS,
    );
    expect(tally.found).toBeGreaterThan(RUNS.numRuns / 2);
    expect(tally.none).toBeGreaterThan(0);
  });
});

describe('upcomingIn: today and tomorrow (property)', () => {
  it('names the claim’s own local day or the next, whose time may lie before the claim, or none on a change', () => {
    fc.assert(
      fc.property(
        claimArb,
        fc.boolean(),
        fc.integer({ min: 0, max: 2 }),
        clockArb,
        sentence,
        (claim, tomorrow, kase, clock, [lead, join, tail]) => {
          const { z, claimMs } = claim;
          const today = localDate(z, claimMs);
          const date = tomorrow ? civilOf(midnightOf(today) + DAY) : today;
          const text = `${lead} ${cased(tomorrow ? 'tomorrow' : 'today', kase)}${join}${clock.text}${tail}`;
          const found = upcomingIn(text, {
            referenceIso: new Date(claimMs).toISOString(),
            offsetAt: z.offsetAt,
          });
          expect(found, text).toBe(expected(z, claimMs, date, clock.minute, true));
        },
      ),
      RUNS,
    );
  });
});

/** A month and day as written: month first or day first, sometimes a year, sometimes a weekday before it. */
const monthDayArb = fc.record({
  month: nameArb(MONTH_NAMES, fc.integer({ min: 0, max: 11 })),
  day: fc.integer({ min: 1, max: 31 }),
  dayFirst: fc.boolean(),
  year: fc.option(fc.integer({ min: 2025, max: 2028 }), { nil: undefined }),
  comma: fc.boolean(),
  weekday: fc.constantFrom('none', 'right', 'any'),
  any: nameArb(WEEKDAY_NAMES, fc.integer({ min: 0, max: 6 })),
});

type Generated<A> = A extends fc.Arbitrary<infer Value> ? Value : never;

/** The date the oracle reads for a month and day, forward from `today` (rules in the file comment). */
function monthDayDate(md: Generated<typeof monthDayArb>, today: Civil): Civil | null {
  const date = { y: md.year ?? today.y, m: md.month.index + 1, d: md.day };
  if (md.year !== undefined || compare(date, today) >= 0) return exists(date) ? date : null;
  const next = { ...date, y: today.y + 1 };
  return exists(next) ? next : null;
}

describe('upcomingIn: a month and a day (property)', () => {
  it('is the first such date on or after the claim’s day, or exactly the year’s, its weekday agreeing', () => {
    fc.assert(
      fc.property(claimArb, monthDayArb, clockArb, sentence, (claim, md, clock, [lead, join, tail]) => {
        const { z, claimMs } = claim;
        let date = monthDayDate(md, localDate(z, claimMs));
        const yearText =
          md.year === undefined ? '' : `${md.comma && !md.dayFirst ? ',' : ''} ${String(md.year)}`;
        const written = md.dayFirst
          ? `${String(md.day)} ${md.month.text}`
          : `${md.month.text} ${String(md.day)}`;
        let weekday = '';
        if (md.weekday === 'any') {
          weekday = `${md.any.text}${md.comma ? ',' : ''} `;
          if (date !== null && weekdayOf(date) !== md.any.index) date = null;
        } else if (md.weekday === 'right' && date !== null) {
          weekday = `${WEEKDAY_NAMES[weekdayOf(date)]?.[0] ?? ''} `;
        }
        const text = `${lead} ${weekday}${written}${yearText}${join}${clock.text}${tail}`;
        const found = upcomingIn(text, {
          referenceIso: new Date(claimMs).toISOString(),
          offsetAt: z.offsetAt,
        });
        expect(found, text).toBe(expected(z, claimMs, date, clock.minute, false));
      }),
      RUNS,
    );
  });
});
