/**
 * Every log the paste parser accepts is one `claims.import` message (src/adapters/paste.ts; tech review TECH-3): the
 * parser refuses what the message would refuse, so a preview the person confirms can always be sent. Before, a log
 * whose timed entries named more than SCHEMA_LIMITS.GRADING_INPUT minutes passed the parser, failed at send without
 * a trace, and the panel said "Try again" forever. Every log here is invented.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { ClaimsImportMessage } from '../../../src/bus/messages';
import { IsoTs, SCHEMA_LIMITS } from '../../../src/core/schema';

const ctx = () => ({
  agent: 'muse' as const,
  pastedAt: IsoTs.parse('2026-10-08T17:00:00-04:00'),
  offsetAt: () => -240,
});

/** A minute of the day on the 24-hour clock ("0:00" to "23:59"), as some agents' logs write it. */
const clock = (minute: number): string =>
  `${String(Math.floor(minute / 60))}:${String(minute % 60).padStart(2, '0')}`;

/**
 * `days` whole days of a log, one day heading each and every minute of it a timed entry ("x" at that minute), after
 * one claim: tech review probe D's shape, 11,520 minutes in under 100,000 characters for eight days.
 */
function everyMinute(days: readonly string[]): string {
  return [
    'Oct 1',
    'Sent an email to sam@example.org',
    '9:15 am',
    ...days.flatMap((day) => [
      day,
      ...Array.from({ length: 24 * 60 }, (_, minute) => ['x', clock(minute)]).flat(),
    ]),
  ].join('\n');
}

describe('a log whose timed entries name more minutes than one import carries', () => {
  it('is refused as a whole (too_many_times); six such days are one valid message', () => {
    const eight = everyMinute(['Sep 30', 'Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6', 'Oct 7']);
    expect(eight.length).toBeLessThan(100_000);
    expect(readPastedLog(eight, ctx())).toEqual({ ok: false, refusal: 'too_many_times' });
    const six = readPastedLog(everyMinute(['Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6', 'Oct 7']), ctx());
    if (!six.ok) throw new Error(six.refusal);
    expect(six.log.activeAt.length).toBeLessThanOrEqual(SCHEMA_LIMITS.GRADING_INPUT);
    const message = {
      type: 'claims.import',
      agent: 'muse',
      claims: six.log.claims,
      activeAt: six.log.activeAt,
    };
    expect(ClaimsImportMessage.safeParse(message).success).toBe(true);
  });
});

const ROWS = [
  'Today',
  'Yesterday',
  'Oct 6',
  'Wednesday',
  'Sent an email to sam@example.org with the deck',
  'Created calendar event "Q3 review" Thu 2pm',
  'Bought a desk lamp for $42.00',
  'Searched for flights to Denver',
  'A task title',
  '4:33 pm',
  '9:05 AM',
  '16:40',
  '',
];

describe('any log the parser accepts (property)', () => {
  it('with a claim, is one valid claims.import message', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ROWS), { minLength: 1, maxLength: 60 }), (rows) => {
        const result = readPastedLog(rows.join('\n'), ctx());
        if (!result.ok || result.log.claims.length === 0) return;
        const { claims, activeAt } = result.log;
        expect(
          ClaimsImportMessage.safeParse({ type: 'claims.import', agent: 'muse', claims, activeAt }).success,
        ).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
