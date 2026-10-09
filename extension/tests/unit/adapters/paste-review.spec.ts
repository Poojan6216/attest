/**
 * The paste parser's defects the Sprint 3 QA review pinned with red tests (reviews/sprint_3/qa.md GAPs 1, 2, 6 and 7),
 * now in the tree and green (src/adapters/paste.ts, src/adapters/claims.ts; Hard Rule 5: a claim is never read on a
 * day the paste does not name):
 *  - GAP 1: a heading the parser cannot place ("September", "2 weeks ago", "Last Thursday", "Oct 1st") makes the day
 *    of the entries under it unknown, never the day of the heading above it;
 *  - GAP 2: a time line holding an invisible character or full-width digits is a clock on its heading's day, never a
 *    time that names its own day;
 *  - GAP 6: the same log pasted in NFC and in NFD gives the same claims, so the second import is never a conflict;
 *  - GAP 7: a move "from Friday at 9am to Tuesday at 10am" targets the start it moved to.
 * Every log is invented; the paste is on Thursday 8 October 2026 at 17:00 in New York.
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
  if (!result.ok) throw new Error(result.refusal);
  return result.log;
};

describe('GAP 1: a heading the parser cannot place', () => {
  it.each([
    'September',
    'September 2026',
    'Sep 2026',
    '2025',
    '2 weeks ago',
    'A week ago',
    'Last Thursday',
    'Oct 1st',
    'Earlier today',
  ])('under “%s”, an entry is never read on the day of the heading above it', (heading) => {
    const log = read(
      'Yesterday',
      'Sent an email to dana@example.com',
      '4:33 pm',
      heading,
      'Sent an email to sam@example.org',
      '9:15 am',
    );
    const sam = log.claims.find((claim) => claim.counterparty === 'sam@example.org');
    expect(sam?.claimedAt).not.toBe('2026-10-07T09:15:00-04:00');
    expect(log.claims.map((claim) => claim.counterparty)).toEqual(['dana@example.com']);
  });

  it('a line with a word that is no date stays an entry’s text', () => {
    const log = read('Yesterday', 'September planning notes', 'Sent an email to sam@example.org', '9:15 am');
    expect(log.claims.map((claim) => claim.claimedAt)).toEqual(['2026-10-07T09:15:00-04:00']);
  });
});

describe('GAP 2: a time line holding invisible or full-width characters', () => {
  it.each(['4:\u200b33 pm', '4:33\u2060 pm', '4:33\u00ad pm', '\uff14:\uff13\uff13 pm', '4\uff1a33 pm'])(
    'a time line holding %j is read on its heading’s day, or not at all',
    (time) => {
      expect(
        read('Yesterday', 'Sent an email to sam@example.org', time).claims.map((c) => c.claimedAt),
      ).toEqual(['2026-10-07T16:33:00-04:00']);
      expect(read('Sent an email to sam@example.org', time).claims).toEqual([]);
    },
  );
});

describe('GAP 6: one log in two Unicode forms', () => {
  it('the same entry pasted in NFC and in NFD gives the same claims', () => {
    const nfc = ['Today', 'Texted Zoë that the meeting moved', '4:33 pm'].map((row) => row.normalize('NFC'));
    expect(read(...nfc.map((row) => row.normalize('NFD'))).claims).toEqual(read(...nfc).claims);
  });
});

describe('GAP 7: a move names the start it moved to', () => {
  it('“from Friday at 9am to Tuesday at 10am” targets Tuesday at 10:00, and a move with no new start targets none', () => {
    const [moved] = read('Today', 'Moved "Standup" from Friday at 9am to Tuesday at 10am', '4:33 pm').claims;
    expect([moved?.type, moved?.targetAt]).toEqual(['calendar.updated', '2026-10-13T10:00:00-04:00']);
    const [vague] = read('Today', 'Moved "Standup" from Friday at 9am to later', '4:33 pm').claims;
    expect([vague?.type, vague?.targetAt]).toEqual(['calendar.updated', undefined]);
  });
});
