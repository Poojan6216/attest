/**
 * src/adapters/paste.ts (sprint_3 3.15): one claim per action type in an entry (a title and its summary report one
 * action), and a calendar claim's event start read from its own words. Every log here is invented.
 */
import { describe, expect, it } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { IsoTs } from '../../../src/core/schema';

const read = (...rows: string[]) => {
  const result = readPastedLog(rows.join('\n'), {
    agent: 'muse',
    pastedAt: IsoTs.parse('2026-10-08T17:00:00-04:00'),
    offsetAt: () => -240,
  });
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.log;
};

describe('one claim per action type in an entry', () => {
  it('a title and its summary of one action give one claim: the one naming more facts', () => {
    const log = read(
      'Today',
      'Sent the venue options',
      'Sent an email to dana@example.com with the options',
      '4:33 pm',
    );
    expect(log.claims.map((c) => [c.type, c.counterparty ?? null])).toEqual([
      ['email.sent', 'dana@example.com'],
    ]);
  });

  it('on a tie the later sentence, the summary, is kept', () => {
    const log = read(
      'Today',
      'Unsubscribed from the newsletter',
      'Unsubscribed you from the newsletter',
      '4:33 pm',
    );
    expect(log.entries[0]?.claims).toHaveLength(1);
    expect(log.claims).toHaveLength(1);
  });

  it('two actions of different types in one entry stay two claims', () => {
    const log = read(
      'Today',
      'Sent an email to dana@example.com',
      'Created event "Venue visit" for Friday at 10am',
      '4:33 pm',
    );
    expect(log.claims.map((c) => c.type)).toEqual(['email.sent', 'calendar.created']);
  });
});

describe('a pasted calendar claim’s event start (targetAt)', () => {
  it('is read forward from the claim’s own time when its words name a day and a time', () => {
    const log = read('Today', 'Created event "Standup" for Monday at 9am', '4:33 pm');
    expect(log.claims.map((c) => c.targetAt)).toEqual(['2026-10-12T09:00:00-04:00']);
  });

  it('is absent when they do not, and the claim then grades no_target', () => {
    const log = read('Today', 'Created event "Standup" for Monday', '4:33 pm');
    expect(log.claims.map((c) => c.targetAt ?? null)).toEqual([null]);
  });
});
