/**
 * When a receipt happened (sprint_2 2.3; agents/adapter_engineer.md rule 7: every parser has a test for midnight,
 * DST and "Yesterday" at 00:30). occurredAt is the message's date (the date cell's `title`, else `alt`, else its
 * visible text), resolved against the pass instant in the page's zone and written with the offset in force then.
 * A date that does not name one minute is never guessed: the pass is DEGRADED and nothing is reported
 * (Hard Rules 5, 6). Zones come from the runtime's time-zone data, so this holds in any machine zone.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs } from '../../../../src/core/schema';
import { ReceiptError } from '../../../../src/observers/gmail/receipts/errors';
import { extractReceipts } from '../../../../src/observers/gmail/receipts/extract';
import { planPass } from '../../../../src/observers/plan';
import { receiptObserver } from '../../../../src/observers/gmail/receipts';
import type { ExtractContext } from '../../../../src/observers/types';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { type MessageSpec, onPage, rows } from './message-page';

const body = rows([['Total', '$23.84']]);
const SUBJECT = 'Your Thursday evening trip with Uber';

function context(readAt: string, zone: string): ExtractContext {
  return { observedAt: IsoTs.parse(readAt), offsetAt: zoneOffset(zone) };
}

function occurredAt(date: Partial<MessageSpec>, readAt: string, zone: string): string | undefined {
  const message: MessageSpec = { from: 'noreply@uber.com', body, ...date };
  const [row] = onPage({ subject: SUBJECT, messages: [message] }, (doc) =>
    planPass({ observer: receiptObserver, doc, ctx: context(readAt, zone), policy: DEFAULT_POLICY }),
  ).observations;
  return row?.occurredAt;
}

describe('midnight', () => {
  const readAt = '2026-10-03T00:30:00-04:00';

  it('a receipt sent at 11:58 PM, read at 00:30, happened the evening before', () => {
    const title = 'Fri, Oct 2, 2026, 11:58 PM';
    expect(occurredAt({ title }, readAt, 'America/New_York')).toBe('2026-10-02T23:58:00-04:00');
  });

  it('with no title, a bare "11:58 PM" read at 00:30 is last night, not tonight', () => {
    const date = { title: null, shown: '11:58 PM (32 minutes ago)' };
    expect(occurredAt(date, readAt, 'America/New_York')).toBe('2026-10-02T23:58:00-04:00');
  });

  it('a receipt at 00:05 read at 00:30 is today', () => {
    const date = { title: 'Sat, Oct 3, 2026, 12:05 AM' };
    expect(occurredAt(date, readAt, 'America/New_York')).toBe('2026-10-03T00:05:00-04:00');
  });
});

describe('"Yesterday" at 00:30', () => {
  const readAt = '2026-10-03T00:30:00-04:00';

  it('"Yesterday, 11:47 PM" (no title) is the day before the read', () => {
    const date = { title: null, shown: 'Yesterday, 11:47 PM' };
    expect(occurredAt(date, readAt, 'America/New_York')).toBe('2026-10-02T23:47:00-04:00');
  });

  it('the alt text is read before the visible text when the title is missing', () => {
    const date = { title: null, alt: 'Thu, Oct 1, 2026, 9:14 PM', shown: 'Yesterday, 11:47 PM' };
    expect(occurredAt(date, readAt, 'America/New_York')).toBe('2026-10-01T21:14:00-04:00');
  });
});

describe('DST', () => {
  it('Pacific/Auckland springs forward on Sun 27 Sep 2026: 1:45 AM is +12:00, 3:10 AM is +13:00', () => {
    const readAt = '2026-09-27T09:00:00+13:00';
    const early = { title: 'Sun, Sep 27, 2026, 1:45 AM' };
    const late = { title: 'Sun, Sep 27, 2026, 3:10 AM' };
    expect(occurredAt(early, readAt, 'Pacific/Auckland')).toBe('2026-09-27T01:45:00+12:00');
    expect(occurredAt(late, readAt, 'Pacific/Auckland')).toBe('2026-09-27T03:10:00+13:00');
  });

  it('a New York time the November fall-back makes ambiguous (1:30 AM) is not guessed: DEGRADED', () => {
    const message: MessageSpec = { from: 'noreply@uber.com', body, title: 'Sun, Nov 1, 2026, 1:30 AM' };
    const ctx = context('2026-11-01T09:00:00-05:00', 'America/New_York');
    onPage({ subject: SUBJECT, messages: [message] }, (doc) => {
      expect(() => extractReceipts(doc, ctx)).toThrow(new ReceiptError('time_unresolved'));
      const plan = planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY });
      expect(plan).toEqual({ status: 'DEGRADED', reasons: ['extract.threw'], observations: [] });
    });
  });

  it('the same clock time a day later reads in the new offset', () => {
    const date = { title: 'Mon, Nov 2, 2026, 1:30 AM' };
    expect(occurredAt(date, '2026-11-02T09:00:00-05:00', 'America/New_York')).toBe(
      '2026-11-02T01:30:00-05:00',
    );
  });
});

describe('a date that names no minute is DEGRADED, never guessed', () => {
  it.each([
    ['a day only', { title: null, shown: 'Oct 1' }],
    ['nothing readable', { title: null, shown: 'soon' }],
  ])('%s', (_case, date) => {
    const message: MessageSpec = { from: 'noreply@uber.com', body, ...date };
    const ctx = context('2026-10-03T10:30:00-04:00', 'America/New_York');
    const plan = onPage({ subject: SUBJECT, messages: [message] }, (doc) =>
      planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
    );
    expect(plan).toEqual({ status: 'DEGRADED', reasons: ['extract.threw'], observations: [] });
  });

  it('a narrow no-break space before PM (as Gmail writes it) still names the minute', () => {
    const date = { title: 'Fri, Oct 2, 2026, 4:17 PM' };
    expect(occurredAt(date, '2026-10-03T10:30:00-04:00', 'America/New_York')).toBe(
      '2026-10-02T16:17:00-04:00',
    );
  });
});
