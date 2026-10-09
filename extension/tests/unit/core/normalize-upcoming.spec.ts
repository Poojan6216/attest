/**
 * src/core/normalize-upcoming.ts (sprint_3 3.15; docs/grading.md §4.1 `targetAt`): an event's start read forward from
 * a claim's own words. The claim is made on Tuesday 6 October 2026 at 14:02 in New York unless a case says otherwise.
 * Every sentence is invented.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MONTH_NAMES, WEEKDAY_NAMES } from '../../../src/core/normalize-names';
import { upcomingIn } from '../../../src/core/normalize-relative';
import { MONTH, WEEKDAY } from '../../../src/core/normalize-upcoming';

/** New York: clocks back at 06:00 UTC on 1 Nov 2026, forward at 07:00 UTC on 14 Mar 2027. */
const newYork = (ms: number): number =>
  ms < Date.UTC(2026, 10, 1, 6) ? -240 : ms < Date.UTC(2027, 2, 14, 7) ? -300 : -240;
const CLAIM = '2026-10-06T14:02:00-04:00';
const at = (sentence: string, referenceIso = CLAIM) =>
  upcomingIn(sentence, { referenceIso, offsetAt: newYork });

describe('upcomingIn: the forms it reads', () => {
  it.each([
    ['Created calendar event "Q3 review" Thu 2pm', '2026-10-08T14:00:00-04:00'],
    ['Created event "Team lunch" for Friday at noon', '2026-10-09T12:00:00-04:00'],
    ['Booked the dentist for Oct 8 at 2:00 pm', '2026-10-08T14:00:00-04:00'],
    ['Moved the sync to 8 October, 14:00', '2026-10-08T14:00:00-04:00'],
    ['Scheduled the call for tomorrow at 9am', '2026-10-07T09:00:00-04:00'],
    ['Added a reminder today at 3 PM', '2026-10-06T15:00:00-04:00'],
    ['Created the event for Monday at 9:30 a.m.', '2026-10-12T09:30:00-04:00'],
    ['Created "Standup" Thursday, Oct 8 at 2pm', '2026-10-08T14:00:00-04:00'],
    ['Created "Offsite" for Oct 8, 2027 at 10am', '2027-10-08T10:00:00-04:00'],
    ['Created "Retro" for Thu. 12 pm and Fri 3pm', '2026-10-08T12:00:00-04:00'],
    ['Created "Late" for Fri 12am', '2026-10-09T00:00:00-04:00'],
    ['Created "Q4 kickoff" Tuesday at 3pm', '2026-10-06T15:00:00-04:00'],
  ])('%s → %s', (sentence, expected) => {
    expect(at(sentence)).toBe(expected);
  });

  it('a date already past this year is next year’s; today may lie before the claim, its day is named', () => {
    expect(at('Created "Board" for Oct 1 at 2pm')).toBe('2027-10-01T14:00:00-04:00');
    expect(at('Created "Lunch" today at 1pm')).toBe('2026-10-06T13:00:00-04:00');
  });
});

describe('upcomingIn: what it leaves unread (Hard Rule 5)', () => {
  it.each([
    ['the claim’s own weekday at a time already past', 'Created "Q4 kickoff" Tuesday at 1pm'],
    ['the claim’s own date at a time already past', 'Created "Q4 kickoff" Oct 6 at 1pm'],
    ['a weekday that disagrees with its date', 'Created "Standup" Wednesday, Oct 8 at 2pm'],
    ['a day with no time', 'Created event "Team lunch" for Friday'],
    ['a time with no day', 'Created event "Team lunch" at 2pm'],
    ['a time before its day', 'Created the event from 2pm to 3pm on Friday'],
    ['midnight', 'Created "Release" for Friday at midnight'],
    ['an impossible clock', 'Created "Odd" for Friday at 13:00 pm'],
    ['a date no year has', 'Created "Odd" for Feb 30 at 9am'],
    ['a word that only starts like a day', 'Created "Mondays" at 9am'],
  ])('%s', (_case, sentence) => {
    expect(at(sentence)).toBeNull();
  });

  it('a time that happens twice, or never, on the day the clocks change', () => {
    expect(at('Created "Night shift" for Sunday at 1:30 am', '2026-10-31T10:00:00-04:00')).toBeNull();
    expect(at('Created "Early" for Sunday at 2:30 am', '2027-03-12T10:00:00-05:00')).toBeNull();
    expect(at('Created "Brunch" for Sunday at 11am', '2026-10-31T10:00:00-04:00')).toBe(
      '2026-11-01T11:00:00-05:00',
    );
  });
});

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

describe('upcomingIn: any weekday and hour (property)', () => {
  it('lands on that weekday at that hour, after the claim and within a week of it, or reads nothing', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2026, 9, 1), max: Date.UTC(2026, 9, 25) }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom('am', 'pm'),
        (claimMs, weekday, hour, meridiem) => {
          const referenceIso = new Date(claimMs - (claimMs % 60_000)).toISOString();
          const found = at(
            `Created "Sync" for ${WEEKDAYS[weekday] ?? ''} at ${String(hour)}${meridiem}`,
            referenceIso,
          );
          if (found === null) return;
          const local = new Date(Date.parse(found) - 4 * 3_600_000);
          expect(local.getUTCDay()).toBe(weekday);
          expect(local.getUTCHours()).toBe((hour % 12) + (meridiem === 'pm' ? 12 : 0));
          expect(Date.parse(found)).toBeGreaterThanOrEqual(Date.parse(referenceIso));
          expect(Date.parse(found) - Date.parse(referenceIso)).toBeLessThan(7 * 86_400_000);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe('the names it reads', () => {
  /** The names a pattern spells, in its order. */
  const spelled = (pattern: string): string[] => /^\(\?:([a-z|]+)\)/u.exec(pattern)?.[1]?.split('|') ?? [];

  it('spells every weekday and month name of the resolver’s tables, and no other, longest first', () => {
    for (const [pattern, table] of [
      [WEEKDAY, WEEKDAY_NAMES],
      [MONTH, MONTH_NAMES],
    ] as const) {
      const names = spelled(pattern);
      expect(new Set(names)).toEqual(new Set(table.flat()));
      expect(names).toHaveLength(table.flat().length);
      expect(names.map((name) => name.length)).toEqual(
        [...names.map((name) => name.length)].sort((a, b) => b - a),
      );
    }
  });
});
