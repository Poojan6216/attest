/**
 * src/adapters/paste.ts at the edges a copied log brings (Sprint 3 QA review; agents/adapter_engineer.md rule 7;
 * docs/claims-import.md §3): every line ending a clipboard uses, the no-break spaces a browser writes before "PM",
 * a byte-order mark, trailing blanks; zones east of UTC, half-hour zones and both kinds of daylight-saving change;
 * and the same log pasted again later, or relabelled by the agent the next day, which must give the same claims
 * (§10 ids), so a second import adds nothing. paste.spec.ts covers New York's autumn change and midnight.
 * Every log here is invented.
 */
import { describe, expect, it } from 'vitest';

import { type PasteContext, readPastedLog } from '../../../src/adapters/paste';
import { IsoTs } from '../../../src/core/schema';

const lines = (...rows: string[]): string => rows.join('\n');

function readAt(text: string, pastedAt: string, offsetAt: PasteContext['offsetAt'] = () => -240) {
  const result = readPastedLog(text, { agent: 'muse', pastedAt: IsoTs.parse(pastedAt), offsetAt });
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.log;
}

const PASTED_AT = '2026-10-08T17:00:00-04:00';
const LOG = [
  'Today',
  'Email the venue options',
  'Sent an email to dana@example.com with the venue options',
  '4:33 pm',
  'Yesterday',
  'Unsubscribed you from the newsletter',
  '6:40 pm',
];
const ids = (text: string, pastedAt = PASTED_AT) => readAt(text, pastedAt).claims.map((claim) => claim.id);

describe('what a clipboard brings', () => {
  it('reads every line ending alike: \\n, \\r\\n, \\r, U+2028 and U+2029', () => {
    const plain = readAt(LOG.join('\n'), PASTED_AT);
    expect(plain.claims).toHaveLength(2);
    for (const ending of ['\r\n', '\r', '\u2028', '\u2029']) {
      const read = readAt(LOG.join(ending), PASTED_AT);
      expect(
        read.claims.map((c) => c.id),
        JSON.stringify(ending),
      ).toEqual(plain.claims.map((c) => c.id));
      expect(read.entries.map((e) => [e.outcome, e.time])).toEqual(
        plain.entries.map((e) => [e.outcome, e.time]),
      );
    }
  });

  it('reads a no-break space before “PM”, a byte-order mark and trailing blanks as plain text', () => {
    const plain = ids(LOG.join('\n'));
    const copied = [
      '\ufeffToday',
      'Email the venue options  ',
      'Sent an email to\u00a0dana@example.com with the venue options\t',
      '4:33\u202fPM',
      'Yesterday ',
      'Unsubscribed you from the newsletter',
      '6:40\u00a0pm',
    ];
    expect(ids(copied.join('\n'))).toEqual(plain);
  });
});

describe('the same log again', () => {
  it('pasted again later the same day gives the same claims', () => {
    expect(ids(LOG.join('\n'), '2026-10-08T23:59:00-04:00')).toEqual(ids(LOG.join('\n')));
  });

  it('pasted the next day, as the agent then labels it (“Yesterday”, the day before), gives the same claims', () => {
    const relabelled = [...LOG];
    relabelled[0] = 'Yesterday';
    relabelled[4] = 'Wednesday';
    expect(ids(relabelled.join('\n'), '2026-10-09T09:00:00-04:00')).toEqual(ids(LOG.join('\n')));
  });
});

/** New York: back an hour at 06:00 UTC on 1 Nov 2026, forward an hour at 07:00 UTC on 14 Mar 2027. */
const newYork = (ms: number): number =>
  ms < Date.UTC(2026, 10, 1, 6) ? -240 : ms < Date.UTC(2027, 2, 14, 7) ? -300 : -240;
/** St John's: back from −02:30 to −03:30 at 04:30 UTC on 1 Nov 2026 (2:00 NDT becomes 1:00 NST). */
const stJohns = (ms: number): number => (ms < Date.UTC(2026, 10, 1, 4, 30) ? -150 : -210);

const timed = (log: ReturnType<typeof readAt>) =>
  log.claims.map((c) => [c.type, c.claimedAt, c.claimedAtPrecision, c.claimedAtEnd ?? null]);

describe('daylight saving', () => {
  it('on the day New York’s clocks go forward, a time the clocks skipped is its whole day, the rest their minute', () => {
    const log = readAt(
      lines(
        'Today',
        'Sent an email to sam@example.org',
        '2:30 am',
        'Unsubscribed you from the newsletter',
        '3:15 am',
        'Created event "Standup" for Monday',
        '1:45 am',
      ),
      '2027-03-14T10:00:00-04:00',
      newYork,
    );
    expect(timed(log)).toEqual([
      ['email.sent', '2027-03-14T00:00:00-05:00', 'day', '2027-03-15T00:00:00-04:00'],
      ['subscription.changed', '2027-03-14T03:15:00-04:00', 'minute', null],
      ['calendar.created', '2027-03-14T01:45:00-05:00', 'minute', null],
    ]);
    expect(log.activeAt).toEqual(['2027-03-14T01:45:00-05:00', '2027-03-14T03:15:00-04:00']);
  });

  it('on the day St John’s goes back half past the hour, only the repeated hour is read as its day', () => {
    const log = readAt(
      lines(
        'Today',
        'Sent an email to sam@example.org',
        '12:30 am',
        'Unsubscribed you from the newsletter',
        '1:30 am',
        'Sent an email to dana@example.com',
        '2:30 am',
      ),
      '2026-11-01T09:00:00-03:30',
      stJohns,
    );
    expect(timed(log)).toEqual([
      ['email.sent', '2026-11-01T00:30:00-02:30', 'minute', null],
      ['subscription.changed', '2026-11-01T00:00:00-02:30', 'day', '2026-11-02T00:00:00-03:30'],
      ['email.sent', '2026-11-01T02:30:00-03:30', 'minute', null],
    ]);
  });
});

describe('zones east of UTC', () => {
  it('pasted just after local midnight: “Today” is the new local day, and a later time is refused', () => {
    const text = lines(
      'Today',
      'Sent an email to sam@example.org',
      '12:10 am',
      'Created event "Standup" for Monday',
      '12:45 am',
      'Yesterday',
      'Unsubscribed you from the newsletter',
      '11:58 pm',
      'Sent an email to dana@example.com',
    );
    const kolkata = readAt(text, '2026-10-08T00:20:00+05:30', () => 330);
    expect(kolkata.entries.map((e) => e.outcome)).toEqual(['claim', 'no_time', 'claim', 'claim']);
    expect(timed(kolkata)).toEqual([
      ['email.sent', '2026-10-08T00:10:00+05:30', 'minute', null],
      ['subscription.changed', '2026-10-07T23:58:00+05:30', 'minute', null],
      ['email.sent', '2026-10-07T00:00:00+05:30', 'day', '2026-10-08T00:00:00+05:30'],
    ]);
    const kiritimati = readAt(text, '2026-10-08T00:30:00+14:00', () => 840);
    expect(timed(kiritimati).map(([, at]) => at)).toEqual([
      '2026-10-08T00:10:00+14:00',
      '2026-10-07T23:58:00+14:00',
      '2026-10-07T00:00:00+14:00',
    ]);
  });
});
