/**
 * The draft-first rule's edges the first tests left open (QA third review of sprint 2, 2026-10-07; gmail.sent 1.3.0,
 * docs/grading.md v1.15). On a list that draws message counts, a row with no count and a thread id older than its
 * message id is one message (a mail composed as a draft first). That holds only while its last message is its last
 * non-draft one: a row whose newest message is a draft (a reply being written on a sent mail) is a conversation, since
 * the row's minute is the draft's and no send of the user's. Before 1.3.0 the thread-id check alone refused such a
 * row; now the last-non-draft check is all that does, and dropping it failed no test (mutant D3 survived).
 */
import { describe, expect, it } from 'vitest';

import type { PassPlan } from '../../../../src/observers/plan';
import { all, one, planVariant, row } from './variants';

type Step = (doc: Document) => void;

const both =
  (...steps: Step[]): Step =>
  (doc) => {
    for (const step of steps) step(doc);
  };

/** Row `index` gets these ids on its subject anchor (thread, last message, last non-draft message). */
const idsOf =
  (index: number, thread: string, last: string, lastNonDraft: string): Step =>
  (doc) => {
    const subject = one(row(doc, index), '[data-legacy-last-message-id]');
    subject.setAttribute('data-legacy-thread-id', thread);
    subject.setAttribute('data-legacy-last-message-id', last);
    subject.setAttribute('data-legacy-last-non-draft-message-id', lastNonDraft);
  };

/** A shown message count right after row `index`'s last recipient, as Gmail draws it ("2"). */
const countAfterLastRecipient =
  (index: number, text = '2'): Step =>
  (doc) => {
    const recipients = all(row(doc, index), '[data-hovercard-id]');
    const count = doc.createElement('span');
    count.textContent = text;
    recipients[recipients.length - 1]?.after(count);
    if (count.parentElement === null) throw new Error('variant: no recipient');
  };

const counterparties = (plan: PassPlan): (string | undefined)[] =>
  plan.observations.map((o) => o.counterparty);
const startsOf = (plan: PassPlan): string[] =>
  plan.status === 'OK' ? plan.coverage.map((c) => c.windowStart) : [];

// Row 0 of synthetic-sent-page-1 (09:41, to alex.rivera@example.com): its sent mail, then a reply draft on it.
const SENT_ID = '1a101ff21e04e756';
const DRAFT_ID = '1a1020aa00000002';
const OLDER_THREAD = '1a101ff21e04e700';

describe('a draft on a sent mail, on a list that draws counts (gmail.sent 1.3.0, QA third review)', () => {
  it('no count, a thread id older than the draft, the last non-draft is the sent mail: a conversation', async () => {
    const plan = await planVariant({
      mutate: both(idsOf(0, OLDER_THREAD, DRAFT_ID, SENT_ID), countAfterLastRecipient(1)),
    });
    expect(plan.status).toBe('OK');
    // Row 0 (the draft's minute) and row 1 (it shows a count) give no row; the other 8 rows' sends are kept.
    expect(counterparties(plan)).not.toContain('alex.rivera@example.com');
    expect(plan.observations).toHaveLength(8);
    // Any send in row 0 was made by its minute, so the window starts one minute after it.
    expect(startsOf(plan)).toEqual(['2026-10-03T09:42:00-04:00']);
  });

  it('the same row with the draft sent (its last message is its last non-draft one) is one message', async () => {
    const plan = await planVariant({
      mutate: both(idsOf(0, OLDER_THREAD, DRAFT_ID, DRAFT_ID), countAfterLastRecipient(1)),
    });
    expect(plan.status).toBe('OK');
    expect(counterparties(plan)).toContain('alex.rivera@example.com');
    expect(plan.observations).toHaveLength(9);
  });
});

/** Row `index`'s last recipient shows `text` as its name, drawn in an element of its own inside the recipient. */
const nameInsideLastRecipient =
  (index: number, text: string): Step =>
  (doc) => {
    const recipients = all(row(doc, index), '[data-hovercard-id]');
    const last = recipients[recipients.length - 1];
    if (last === undefined) throw new Error('variant: no recipient');
    const name = doc.createElement('span');
    name.textContent = text;
    last.replaceChildren(name);
  };

describe('a number inside a recipient is a name, never a message count (QA third review)', () => {
  it('a last recipient whose name is a number: its row stays one message and the list draws no count', async () => {
    const base = await planVariant();
    const plan = await planVariant({ mutate: nameInsideLastRecipient(1, '12') });
    expect(plan.status).toBe('OK');
    // Row 1 (two recipients, one id) still gives both its rows, and the window is the page's own.
    expect(plan.observations).toHaveLength(base.observations.length);
    expect(counterparties(plan)).toEqual(counterparties(base));
    expect(startsOf(plan)).toEqual(startsOf(base));
  });

  it('so on a list with draft-first rows and no count, that name never makes them single sends', async () => {
    const plan = await planVariant({
      mutate: both(idsOf(0, OLDER_THREAD, SENT_ID, SENT_ID), nameInsideLastRecipient(1, '12')),
    });
    expect(plan.status).toBe('OK');
    // No count anywhere: row 0 is read by its ids alone, a conversation, as under 1.2.0.
    expect(counterparties(plan)).not.toContain('alex.rivera@example.com');
    expect(startsOf(plan)).toEqual(['2026-10-03T09:42:00-04:00']);
  });
});
