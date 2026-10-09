/**
 * src/adapters/paste.ts (sprint_3 3.11; docs/claims-import.md §3): claims from a log the person pastes.
 *  - entries split on time lines, leading times, day headings and blank lines, each held to the claim builder;
 *  - a clock time is read on the day of the heading above it, in the person's zone; a time inside a sentence is text;
 *  - no day named, no time, an entry right above a heading, or a time after the paste: no claim (Hard Rule 5);
 *  - proposals are `other`, chatter is nothing; pasting the same log twice gives the same claims (§10 ids);
 *  - an empty or over-long paste, or one with more claims than an import carries, is refused, never cut;
 *  - nothing but the claim fields leaves the parser (Hard Rule 2).
 * Every log here is invented, in the shape each agent's own log takes (no value from any real page).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_PASTE_CHARS,
  type PasteContext,
  PASTE_VERSION,
  readPastedLog,
} from '../../../src/adapters/paste';
import { PROPOSAL_CONFIDENCE } from '../../../src/adapters/patterns';
import { Claim, IsoTs, SCHEMA_LIMITS } from '../../../src/core/schema';

const PASTED_AT = IsoTs.parse('2026-10-08T17:00:00-04:00');
const ctx = (agent: PasteContext['agent'] = 'muse'): PasteContext => ({
  agent,
  pastedAt: PASTED_AT,
  offsetAt: () => -240,
});

function read(text: string, agent: PasteContext['agent'] = 'muse') {
  const result = readPastedLog(text, ctx(agent));
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.log;
}

const lines = (...rows: string[]): string => rows.join('\n');
const outcomes = (text: string) => read(text).entries.map((e) => [e.outcome, e.time]);

const MUSE_LOG = lines(
  'Today',
  'Email the venue options',
  'Sent an email to dana@example.com with the venue options',
  '4:33 pm',
  'Plan the team lunch',
  'Created event "Team lunch" for Friday at noon',
  '3:10 pm',
  'Look up flights',
  'Searched for flights to Denver',
  '2:05 pm',
  'Yesterday',
  'Order coffee beans',
  'Ordered 2 bags of coffee beans for €24.50',
  '6:40 pm',
);

describe('a log in Muse’s shape: a title, what was done, then a time, under day headings', () => {
  it('gives one entry per block, a claim for each reported action at its minute, nothing for a search', () => {
    const log = read(MUSE_LOG);
    expect(log.entries.map((e) => [e.outcome, e.time])).toEqual([
      ['claim', 'Today, 4:33 pm'],
      ['claim', 'Today, 3:10 pm'],
      ['no_claim', 'Today, 2:05 pm'],
      ['claim', 'Yesterday, 6:40 pm'],
    ]);
    expect(log.claims.map((c) => [c.type, c.claimedAt, c.claimedAtPrecision])).toEqual([
      ['email.sent', '2026-10-08T16:33:00-04:00', 'minute'],
      ['calendar.created', '2026-10-08T15:10:00-04:00', 'minute'],
      ['purchase.made', '2026-10-07T18:40:00-04:00', 'minute'],
    ]);
    expect(log.claims[0]).toMatchObject({ counterparty: 'dana@example.com', sourceKind: 'activity_view' });
    expect(log.claims[1]?.subjectHint).toBe('Team lunch');
    expect(log.claims[2]).toMatchObject({ amountCents: 2450, currency: 'EUR' });
    for (const claim of log.claims) {
      expect(Claim.parse(claim)).toEqual(claim);
      expect(claim.extractor).toMatchObject({ id: 'import.muse', version: PASTE_VERSION });
      expect(claim).not.toHaveProperty('requestId');
    }
  });

  it('reads an approval card as a proposal (`other`), never as the purchase it asks about', () => {
    const log = read(
      lines('Today', 'Buy a blender', 'Awaiting your approval to buy the blender for $89', '4:50 pm'),
    );
    expect(log.claims.map((c) => [c.type, c.extractor.confidence])).toEqual([['other', PROPOSAL_CONFIDENCE]]);
  });

  it('never takes a time inside a sentence, or a time range, for the entry’s own time', () => {
    const log = read(
      lines(
        'Today',
        'Plan the team lunch',
        'Created event "Team lunch" for Friday at 12:30 pm',
        '3:10 pm',
        '9:00 - 9:30 Standup',
        'Sent the agenda to sam@example.org',
        '3:20 pm',
      ),
    );
    expect(log.entries.map((e) => [e.outcome, e.time])).toEqual([
      ['claim', 'Today, 3:10 pm'],
      ['claim', 'Today, 3:20 pm'],
    ]);
    expect(log.claims.map((c) => [c.type, c.claimedAt])).toEqual([
      ['calendar.created', '2026-10-08T15:10:00-04:00'],
      ['email.sent', '2026-10-08T15:20:00-04:00'],
    ]);
  });
});

describe('a step list: one step per line, its time leading it', () => {
  it('reads the time before a separator, on its heading’s day', () => {
    const log = read(
      lines(
        'Yesterday',
        '4:01 PM · Opened the checkout page',
        '4:02 PM - Completed checkout for a desk lamp at $34.99',
        '4:03 PM | Sent email to sam@example.org',
      ),
      'chatgpt',
    );
    expect(log.entries.map((e) => [e.outcome, e.time])).toEqual([
      ['no_claim', 'Yesterday, 4:01 PM'],
      ['claim', 'Yesterday, 4:02 PM'],
      ['claim', 'Yesterday, 4:03 PM'],
    ]);
    expect(log.claims.map((c) => [c.type, c.claimedAt])).toEqual([
      ['purchase.made', '2026-10-07T16:02:00-04:00'],
      ['email.sent', '2026-10-07T16:03:00-04:00'],
    ]);
  });
});

describe('days and headings', () => {
  it('reads weekday and date headings, and a time that names its own day as written', () => {
    const log = read(
      lines(
        'Monday',
        'Sent an email to sam@example.org',
        '9:15 am',
        'Oct 6',
        'Created event "Standup" for Friday',
        '16:40',
        'Unsubscribed you from the newsletter',
        'Yesterday, 8:05 am',
      ),
    );
    expect(log.claims.map((c) => [c.type, c.claimedAt])).toEqual([
      ['email.sent', '2026-10-05T09:15:00-04:00'],
      ['calendar.created', '2026-10-06T16:40:00-04:00'],
      ['subscription.changed', '2026-10-07T08:05:00-04:00'],
    ]);
  });

  it('under a day heading, an entry without a time of its own is read at day precision', () => {
    const log = read(
      lines('Yesterday', 'Sent an email to sam@example.org', '', 'Unsubscribed you from the newsletter'),
    );
    expect(log.claims.map((c) => [c.type, c.claimedAt, c.claimedAtPrecision, c.claimedAtEnd])).toEqual([
      ['email.sent', '2026-10-07T00:00:00-04:00', 'day', '2026-10-08T00:00:00-04:00'],
      ['subscription.changed', '2026-10-07T00:00:00-04:00', 'day', '2026-10-08T00:00:00-04:00'],
    ]);
  });
});

describe('entries the paste names no day for', () => {
  it('a clock time with no day heading above it is “no day”, and the preview still shows the time', () => {
    expect(outcomes(lines('Sent an email to sam@example.org', '4:33 pm'))).toEqual([['no_day', '4:33 pm']]);
    expect(outcomes('4:33 PM · Sent an email to sam@example.org')).toEqual([['no_day', '4:33 PM']]);
  });

  it('under a heading that names no one day, a clock time is “no day”; a time with its own day is read', () => {
    const text = lines(
      'Previous 7 days',
      'Sent an email to sam@example.org',
      '4:33 pm',
      'Created event "Standup" for Monday',
      'Oct 6, 9:15 am',
      '10/5/2026',
      'Unsubscribed you from the newsletter',
      '8:05 am',
    );
    expect(outcomes(text)).toEqual([
      ['no_day', 'Previous 7 days, 4:33 pm'],
      ['claim', 'Oct 6, 9:15 am'],
      ['no_day', '10/5/2026, 8:05 am'],
    ]);
    expect(read(text).claims.map((c) => c.claimedAt)).toEqual(['2026-10-06T09:15:00-04:00']);
  });

  it('an entry right above a day heading has no time: that day could be its own, or the next section’s', () => {
    expect(
      outcomes(
        lines(
          'Today',
          'Sent an email to sam@example.org',
          'Yesterday',
          'Unsubscribed you from the newsletter',
        ),
      ),
    ).toEqual([
      ['no_time', null],
      ['claim', 'Yesterday'],
    ]);
  });
});

describe('entries without a time', () => {
  it('a log with no times at all (Claude’s thread shows none) imports nothing, and says why', () => {
    const log = read(
      lines('Created event "Design review" via Google Calendar', '', 'I sent the email to priya@example.com'),
      'claude',
    );
    expect(log.entries.map((e) => e.outcome)).toEqual(['no_time', 'no_time']);
    expect(log.claims).toEqual([]);
  });

  it('a time after the paste gives no claim', () => {
    expect(outcomes(lines('Today', 'Sent an email to sam@example.org', '5:30 pm'))).toEqual([
      ['no_time', 'Today, 5:30 pm'],
    ]);
  });
});

/** New York, whose clocks went back an hour at 06:00 UTC on 1 November 2026 (2:00 EDT became 1:00 EST). */
const newYork = (ms: number): number => (ms < Date.UTC(2026, 10, 1, 6) ? -240 : -300);

function readAt(text: string, pastedAt: string, offsetAt: PasteContext['offsetAt']) {
  const result = readPastedLog(text, { agent: 'muse', pastedAt: IsoTs.parse(pastedAt), offsetAt });
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.log;
}

describe('midnight and daylight saving (agents/adapter_engineer.md rule 7)', () => {
  it('pasted at 00:30, “Today” is the new day, “Yesterday” the one that just ended, and a later time is refused', () => {
    const log = readAt(
      lines(
        'Today',
        'Sent an email to sam@example.org',
        '12:10 am',
        'Created event "Standup" for Monday',
        '12:45 am',
        'Yesterday',
        'Unsubscribed you from the newsletter',
        '11:58 pm',
      ),
      '2026-10-08T00:30:00-04:00',
      () => -240,
    );
    expect(log.entries.map((e) => e.outcome)).toEqual(['claim', 'no_time', 'claim']);
    expect(log.claims.map((c) => c.claimedAt)).toEqual([
      '2026-10-08T00:10:00-04:00',
      '2026-10-07T23:58:00-04:00',
    ]);
  });

  it('on the day the clocks go back, a time that happened twice is read as its day; the others keep their offset', () => {
    const log = readAt(
      lines(
        'Today',
        'Sent an email to sam@example.org',
        '9:15 am',
        'Created event "Standup" for Monday',
        '1:30 am',
        'Unsubscribed you from the newsletter',
        'Today, 1:20 am',
        'Cancelled the 4pm call with the vendor',
        '3:40 am',
        'Yesterday',
        'Sent an email to dana@example.com',
        '4:33 pm',
      ),
      '2026-11-01T10:00:00-05:00',
      newYork,
    );
    expect(log.entries.map((e) => [e.outcome, e.time])).toEqual([
      ['claim', 'Today, 9:15 am'],
      ['claim', 'Today, 1:30 am'],
      ['claim', 'Today, 1:20 am'],
      ['claim', 'Today, 3:40 am'],
      ['claim', 'Yesterday, 4:33 pm'],
    ]);
    expect(log.claims.map((c) => [c.claimedAt, c.claimedAtPrecision])).toEqual([
      ['2026-11-01T09:15:00-05:00', 'minute'],
      ['2026-11-01T00:00:00-04:00', 'day'],
      ['2026-11-01T00:00:00-04:00', 'day'],
      ['2026-11-01T03:40:00-05:00', 'minute'],
      ['2026-10-31T16:33:00-04:00', 'minute'],
    ]);
  });
});

describe('the paste as a whole', () => {
  it('pasting the same log twice gives the same claims (§10 ids)', () => {
    expect(read(MUSE_LOG).claims.map((c) => c.id)).toEqual(read(MUSE_LOG).claims.map((c) => c.id));
  });

  it('refuses an empty paste, one over the limit, and one with more claims than an import carries, never cut', () => {
    expect(readPastedLog('  \n\n ', ctx())).toEqual({ ok: false, refusal: 'empty' });
    expect(readPastedLog('a'.repeat(MAX_PASTE_CHARS + 1), ctx())).toEqual({ ok: false, refusal: 'too_long' });
    const many = Array.from(
      { length: SCHEMA_LIMITS.BATCH + 1 },
      (_, i) => `Sent an email to person${String(i)}@example.com\n4:${String(i % 60).padStart(2, '0')} pm`,
    );
    expect(readPastedLog(lines('Today', ...many), ctx())).toEqual({ ok: false, refusal: 'too_many_claims' });
  });

  it('keeps nothing of an entry but the claim’s fields (Hard Rule 2)', () => {
    const secret = 'zq-7781-private-note';
    const log = read(
      lines('Today', `Email the venue options ${secret}`, 'Sent an email to dana@example.com', '4:33 pm'),
    );
    expect(log.claims).toHaveLength(1);
    expect(JSON.stringify(log.claims)).not.toContain(secret);
  });
});

/** An invented action report and the type it claims (null: none). */
const ACTIONS = [
  ['Sent an email to sam@example.org', 'email.sent'],
  ['Created event "Standup" for Monday', 'calendar.created'],
  ['Cancelled the 4pm call with the vendor', 'calendar.deleted'],
  ['Unsubscribed you from the newsletter', 'subscription.changed'],
  ['Searched for flights to Denver', null],
] as const;

/** A minute of the day as a log writes it ("12:05 am", "4:33 pm"). */
function clockText(minute: number): string {
  const hour = Math.floor(minute / 60);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(twelve)}:${String(minute % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

const isoToday = (minute: number): string =>
  `2026-10-08T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00-04:00`;

describe('any log in Muse’s shape (property)', () => {
  it('gives each block its own entry, each action its minute unless after the paste, and the same ids twice', () => {
    const block = fc.tuple(
      fc.constantFrom(...ACTIONS),
      fc.integer({ min: 0, max: 24 * 60 - 1 }),
      fc.boolean(),
    );
    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 20 }), (blocks) => {
        const text = lines(
          'Today',
          ...blocks.flatMap(([[sentence], minute, titled]) => [
            ...(titled ? ['A task title'] : []),
            sentence,
            clockText(minute),
          ]),
        );
        const log = read(text);
        expect(log.entries).toHaveLength(blocks.length);
        blocks.forEach(([[, type], minute], index) => {
          const entry = log.entries[index];
          if (type === null) expect(entry?.outcome).toBe('no_claim');
          else if (minute > 17 * 60) expect(entry?.outcome).toBe('no_time');
          else expect(entry?.claims.map((c) => [c.type, c.claimedAt])).toEqual([[type, isoToday(minute)]]);
        });
        expect(read(text).claims.map((c) => c.id)).toEqual(log.claims.map((c) => c.id));
      }),
      { numRuns: 200 },
    );
  });
});

describe('any log that names no day (property)', () => {
  it('gives no claim, whatever its times and headings', () => {
    const undated = [
      '',
      'A task title',
      '4:33 pm',
      '11:05 AM',
      '16:40',
      '4:01 PM · Sent an email to sam@example.org',
      'Earlier',
      'Last week',
      '10/6/2026',
      ...ACTIONS.map(([sentence]) => sentence),
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...undated), { minLength: 1, maxLength: 40 }), (rows) => {
        const result = readPastedLog(lines(...rows), ctx());
        if (result.ok) expect(result.log.claims).toEqual([]);
        else expect(result.refusal).toBe('empty');
      }),
      { numRuns: 300 },
    );
  });
});
