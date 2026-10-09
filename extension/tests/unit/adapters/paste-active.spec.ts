/**
 * src/adapters/paste.ts `PastedLog.activeAt` (sprint_3 3.14; docs/grading.md §7): the minutes a pasted log's timed
 * entries name, a claim or not, which become the agent's session pings. Every log here is invented.
 */
import { describe, expect, it } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { IsoTs } from '../../../src/core/schema';

const lines = (...rows: string[]): string => rows.join('\n');

function read(text: string) {
  const result = readPastedLog(text, {
    agent: 'muse',
    pastedAt: IsoTs.parse('2026-10-08T17:00:00-04:00'),
    offsetAt: () => -240,
  });
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.log;
}

describe('the minutes the log names (sprint_3 3.14)', () => {
  it('are every timed entry’s minute, a claim or not, each once and in order; a day or no time names none', () => {
    const log = read(
      lines(
        'Today',
        'Searched for flights to Denver',
        '2:05 pm',
        'Sent an email to dana@example.com',
        '4:33 pm',
        'Created event "Standup" for Monday',
        '4:33 pm',
        'Yesterday',
        'Unsubscribed you from the newsletter',
        '',
        'Earlier',
        'Sent an email to sam@example.org',
        '9:15 am',
        'Looked up the invoice',
        '5:30 pm',
      ),
    );
    expect(log.activeAt).toEqual(['2026-10-08T14:05:00-04:00', '2026-10-08T16:33:00-04:00']);
  });
});
