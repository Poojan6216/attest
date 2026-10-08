/**
 * Gmail Sent times (sprint_2 2.2; agents/adapter_engineer.md rule 7: midnight, DST and "Yesterday" at 00:30;
 * docs/grading.md §11; Hard Rule 5), and the conversation-view rule: a row is timed only when it provably holds one
 * message, so a send is never recorded at a received reply's time. A row that cannot be timed is refused by
 * `project()` (the 2.0 contract): the pass is DEGRADED and gives no coverage, and the other rows still count.
 * A mail composed as a draft first is one message though its ids differ: the list's message counts tell it apart
 * (live smoke of 2026-10-07, gmail.sent 1.3.0).
 */
import { describe, expect, it } from 'vitest';

import { minuteOf } from '../../../../src/observers/gmail/sent-time';
import type { PassPlan } from '../../../../src/observers/plan';
import { fixtureCtx, fixtureNamed, openFixture, runSentPass } from './sent-fixtures';
import { all, newYorkCtx, one, planVariant, row, setRowTime } from './variants';

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

const ids = (thread: string, last: string, nonDraft: string | null) => (doc: Document) => {
  const subject = one(row(doc, 0), '[data-legacy-last-message-id]');
  subject.setAttribute('data-legacy-thread-id', thread);
  subject.setAttribute('data-legacy-last-message-id', last);
  if (nonDraft === null) subject.removeAttribute('data-legacy-last-non-draft-message-id');
  else subject.setAttribute('data-legacy-last-non-draft-message-id', nonDraft);
};
const reply = ids('1a101ff21e04e756', '1a1020aa00000001', '1a1020aa00000001');
const startsOf = (plan: PassPlan): string[] =>
  plan.status === 'OK' ? plan.coverage.map((c) => c.windowStart) : [];

describe('conversation view: a row of several messages gives no row and bounds the window (capture of 2026-10-06)', () => {
  it.each([
    ['a received reply is the newest message', reply],
    ['a draft sits on the thread', ids('1a101ff21e04e756', '1a1020aa00000002', '1a101ff21e04e756')],
  ])(
    '%s: that row gives no row, the others are kept, the window starts after its minute',
    async (_name, mutate) => {
      const plan = await planVariant({ mutate });
      expect(plan.status).toBe('OK');
      expect(plan.observations).toHaveLength(10);
      expect(plan.observations.map((o) => o.counterparty)).not.toContain('alex.rivera@example.com');
      // Row 0 is the newest (09:41): any send of the user's in it was made by then.
      expect(startsOf(plan)).toEqual(['2026-10-03T09:42:00-04:00']);
    },
  );

  it('a row missing an id cannot be told apart: refused, no coverage (a markup change is loud)', async () => {
    const plan = await planVariant({ mutate: ids('1a101ff21e04e756', '1a101ff21e04e756', null) });
    expect(plan).toMatchObject(UNTIMED);
    expect(plan.observations).toHaveLength(10);
  });
});

describe("ids not in Gmail's form, and a list out of order (re-review, TECH-R3 and TECH-R8)", () => {
  it.each([
    ['an empty thread id', ids('', '1a101ff21e04e756', '1a101ff21e04e756')],
    ['a prefixed thread id', ids('thread-f:1a101ff21e04e756', '1a101ff21e04e756', '1a101ff21e04e756')],
    ['an id in upper case', ids('1A101FF21E04E756', '1A101FF21E04E756', '1A101FF21E04E756')],
  ])(
    '%s is not in Gmail’s id form: refused, no coverage (TECH-R3: a change of form is loud)',
    async (_, mutate) => {
      const plan = await planVariant({ mutate });
      expect(plan).toMatchObject(UNTIMED);
      expect(plan.observations).toHaveLength(10);
    },
  );

  it('every row’s thread id emptied (a markup change across the list) is DEGRADED, never OK with no row', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        for (const anchor of Array.from(doc.querySelectorAll('[data-legacy-thread-id]')))
          anchor.setAttribute('data-legacy-thread-id', '');
      },
    });
    expect(plan.status).toBe('DEGRADED');
    expect(plan.observations).toEqual([]);
  });

  it('a list whose shown minutes go up down the page vouches for no window (TECH-R8)', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        setRowTime(row(doc, 2), { title: 'Sat, Oct 3, 2026, 9:50 AM', label: '9:50 AM' });
      },
    });
    expect(plan).toMatchObject({ status: 'DEGRADED', reasons: ['window.unknown'] });
    expect(plan.observations.length).toBeGreaterThan(0);
  });

  it('a conversation in the minute being read leaves no whole minute: OK, no coverage', async () => {
    const plan = await planVariant({ mutate: reply, ctx: newYorkCtx('2026-10-03T09:41:30-04:00') });
    expect(plan.status).toBe('OK_NO_COVERAGE');
    expect(plan.observations).toHaveLength(10);
  });

  it('a conversation whose time cannot be read leaves the window unknown: DEGRADED', async () => {
    const plan = await planVariant({
      mutate: (doc) => {
        reply(doc);
        setRowTime(row(doc, 0), { title: null, label: '' });
      },
    });
    expect(plan).toMatchObject({ status: 'DEGRADED', reasons: ['window.unknown'] });
    expect(plan.observations).toHaveLength(10);
  });
});

type Step = (doc: Document) => void;
const both =
  (...steps: Step[]): Step =>
  (doc) => {
    for (const step of steps) step(doc);
  };
/** Row `index` with a thread id older than its message id, its key kept: a draft-first mail, or a conversation. */
const olderThread =
  (index: number): Step =>
  (doc) => {
    one(row(doc, index), '[data-legacy-last-message-id]').setAttribute(
      'data-legacy-thread-id',
      `1a1000000000000${String(index)}`,
    );
  };
/** A span with `text` put by `place` in row `index` (Gmail draws its count right after the last recipient). */
const countAt =
  (index: number, text: string, place: 'after' | 'before' | 'subject', style?: string): Step =>
  (doc) => {
    const target = row(doc, index);
    const count = doc.createElement('span');
    count.textContent = text;
    if (style !== undefined) count.setAttribute('style', style);
    const recipients = all(target, '[data-hovercard-id]');
    const anchor = one(target, '[data-legacy-last-message-id]');
    if (place === 'after') recipients[recipients.length - 1]?.after(count);
    else if (place === 'before') recipients[0]?.before(count);
    else anchor.after(count);
    if (count.parentElement === null) throw new Error('variant: no recipient');
  };
const countAfter = (index: number, text = '2', style?: string): Step => countAt(index, text, 'after', style);
const counterparties = (plan: PassPlan): (string | undefined)[] =>
  plan.observations.map((o) => o.counterparty);

describe('a mail composed as a draft first (live smoke of 2026-10-07, gmail.sent 1.3.0)', () => {
  it('on a list that draws counts, an older thread id and no count is one message: a row at its own minute', async () => {
    const plan = await planVariant({ mutate: both(olderThread(0), olderThread(1), countAfter(1)) });
    expect(plan.status).toBe('OK');
    expect(plan.observations[0]).toMatchObject({
      counterparty: 'alex.rivera@example.com',
      occurredAt: '2026-10-03T09:41:00-04:00',
    });
    // Row 1 (08:05, to two people) shows a count: a conversation, no row, and the window starts after it.
    expect(counterparties(plan)).not.toContain('priya.raman@example.org');
    expect(plan.observations).toHaveLength(9);
    expect(startsOf(plan)).toEqual(['2026-10-03T08:06:00-04:00']);
  });

  it.each([
    ['with a count beside it is a conversation', both(olderThread(0), countAfter(0))],
    ['on a list that draws no count is read by its ids alone: a conversation, as before', olderThread(0)],
    [
      'whose ids are one id but which shows a count is not timed: they contradict (Hard Rule 5)',
      countAfter(0),
    ],
  ])('the row %s: no row, the window starts after it', async (_name, mutate) => {
    const plan = await planVariant({ mutate });
    expect(plan.status).toBe('OK');
    expect(counterparties(plan)).not.toContain('alex.rivera@example.com');
    expect(plan.observations).toHaveLength(10);
    expect(startsOf(plan)).toEqual(['2026-10-03T09:42:00-04:00']);
  });

  it.each([
    ['kept hidden (display: none)', countAfter(1, '2', 'display: none')],
    ['"0"', countAfter(1, '0')],
    ['"12345"', countAfter(1, '12345')],
    ['"(2)"', countAfter(1, '(2)')],
    ['before the recipients', countAt(1, '2', 'before')],
    ['in the subject cell', countAt(1, '2', 'subject')],
  ])(
    'a number %s is no count: the list draws none, so the draft-first row stays a conversation',
    async (_name, count) => {
      const plan = await planVariant({ mutate: both(olderThread(0), olderThread(1), count) });
      expect(plan.status).toBe('OK');
      expect(counterparties(plan)).not.toContain('alex.rivera@example.com');
      expect(plan.observations).toHaveLength(8);
      expect(startsOf(plan)).toEqual(['2026-10-03T09:42:00-04:00']);
    },
  );
});
