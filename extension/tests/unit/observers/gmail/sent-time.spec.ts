/**
 * Gmail Sent times (sprint_2 2.2; agents/adapter_engineer.md rule 7: midnight, DST and "Yesterday" at 00:30;
 * docs/grading.md §11; Hard Rule 5), and the conversation-view rule: a row is timed only when it provably holds one
 * message, so a send is never recorded at a received reply's time. A row that cannot be timed is refused by
 * `project()` (the 2.0 contract): the pass is DEGRADED and gives no coverage, and the other rows still count.
 */
import { describe, expect, it } from 'vitest';

import { minuteOf } from '../../../../src/observers/gmail/sent-time';
import { fixtureCtx, fixtureNamed, openFixture, runSentPass } from './sent-fixtures';
import { newYorkCtx, one, planVariant, row, setRowTime } from './variants';

const UNTIMED = { status: 'DEGRADED', reasons: ['redact.missing_occurred_at', 'window.unknown'] };

async function occurredAt(file: string): Promise<string[]> {
  const plan = await runSentPass(fixtureNamed(file));
  return plan.observations.map((o) => o.occurredAt);
}

describe('midnight, DST and "Yesterday" at 00:30 (fixtures)', () => {
  it('read at 00:30: "11:58 PM" is last night and "Yesterday, 11:47 PM" is Fri 23:47; midnight is 00:00', async () => {
    const times = await occurredAt('synthetic-sent-midnight.html');
    expect(times).toEqual([
      '2026-10-03T00:21:00-04:00',
      '2026-10-02T23:59:00-04:00',
      '2026-10-02T23:58:00-04:00',
      '2026-10-02T23:47:00-04:00',
      '2026-10-02T00:00:00-04:00',
    ]);
  });

  it('Pacific/Auckland on the spring-forward day: 1:45 AM is +12:00, 3:10 AM is +13:00', async () => {
    const times = await occurredAt('synthetic-sent-dst-auckland.html');
    expect(times).toContain('2026-09-27T01:45:00+12:00');
    expect(times).toContain('2026-09-27T03:10:00+13:00');
  });

  it('a U+202F before AM/PM in the title reads as a space', async () => {
    expect(await occurredAt('synthetic-sent-page-1.html')).toContain('2026-10-03T09:41:00-04:00');
  });
});

describe('a clock time a DST change makes ambiguous or skipped is refused, not guessed', () => {
  const cases: [string, string, string][] = [
    ['1:30 AM on the fall-back day (it happens twice)', '2026-11-01T09:00:00-05:00', '1:30 AM'],
    ['2:30 AM on the spring-forward day (it never happens)', '2026-03-08T09:00:00-04:00', '2:30 AM'],
  ];

  it.each(cases)('%s', async (_name, at, label) => {
    const plan = await planVariant({
      ctx: newYorkCtx(at),
      mutate: (doc) => {
        setRowTime(row(doc, 0), { title: null, label });
      },
    });
    expect(plan).toMatchObject(UNTIMED);
    expect(plan.observations).toHaveLength(10);
  });
});

describe('which text decides', () => {
  const page = async (title: string | null, label: string) =>
    planVariant({
      mutate: (doc) => {
        setRowTime(row(doc, 0), { title, label });
      },
    });

  it('the absolute title wins over the visible text', async () => {
    const plan = await page('Sat, Oct 3, 2026, 9:41 AM', '8:00 AM');
    expect(plan.status).toBe('OK');
    expect(plan.observations[0]?.occurredAt).toBe('2026-10-03T09:41:00-04:00');
  });

  it('a title that does not read as a time falls back to the visible text', async () => {
    const plan = await page('sáb., 3 oct. 2026 9:41', '9:41 AM');
    expect(plan.status).toBe('OK');
    expect(plan.observations[0]?.occurredAt).toBe('2026-10-03T09:41:00-04:00');
  });

  it('a title that names only a day is not overruled by a clock in the text', async () => {
    expect(await page('Sat, Oct 3, 2026', '9:41 AM')).toMatchObject(UNTIMED);
  });

  it('a text that names only a day ("Oct 1") is refused', async () => {
    expect(await page(null, 'Oct 1')).toMatchObject(UNTIMED);
  });

  it('an element with no title, label or text names no minute', async () => {
    const fixture = fixtureNamed('synthetic-sent-page-1.html');
    const page = openFixture(fixture);
    try {
      expect(minuteOf(page.doc.createElement('span'), fixtureCtx(fixture))).toBeNull();
    } finally {
      await page.close();
    }
  });
});

describe('conversation view: a row is a send only when it holds one message', () => {
  const ids = (thread: string, last: string, nonDraft: string | null) => (doc: Document) => {
    const subject = one(row(doc, 0), '[data-legacy-last-message-id]');
    subject.setAttribute('data-legacy-thread-id', thread);
    subject.setAttribute('data-legacy-last-message-id', last);
    if (nonDraft === null) subject.removeAttribute('data-legacy-last-non-draft-message-id');
    else subject.setAttribute('data-legacy-last-non-draft-message-id', nonDraft);
  };

  it.each([
    [
      'a received reply is the newest message',
      ids('1a101ff21e04e756', '1a1020aa00000001', '1a1020aa00000001'),
    ],
    ['a draft sits on the thread', ids('1a101ff21e04e756', '1a1020aa00000002', '1a101ff21e04e756')],
    ['a row without its non-draft id', ids('1a101ff21e04e756', '1a101ff21e04e756', null)],
  ])('%s: that row is refused, the others kept, no coverage', async (_name, mutate) => {
    const plan = await planVariant({ mutate });
    expect(plan).toMatchObject(UNTIMED);
    expect(plan.observations).toHaveLength(10);
    expect(plan.observations.map((o) => o.counterparty)).not.toContain('alex.rivera@example.com');
  });
});
