/**
 * The seven platform parsers beyond their labelled fixtures (sprint_2 2.3; src/observers/gmail/receipts/
 * selectors.json `platforms`): a sender in the registry is read only by its own parser, only mail whose subject is
 * a receipt kind is a receipt, the amount is the labelled total and nothing else, and a receipt whose total line
 * is missing or reads two ways makes the pass DEGRADED instead of guessing (Hard Rules 5, 6).
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs } from '../../../../src/core/schema';
import { planPass } from '../../../../src/observers/plan';
import { receiptObserver, receiptVerdicts } from '../../../../src/observers/gmail/receipts';
import { type MessageSpec, onPage, paragraphs, rows } from './message-page';

const ctx = { observedAt: IsoTs.parse('2026-10-03T10:30:00-04:00'), offsetAt: () => -240 };

function verdicts(subject: string, from: string, body: string, name = 'Sender') {
  return onPage({ subject, messages: [{ from, name, body }] }, (doc) => receiptVerdicts(doc));
}

function one(subject: string, from: string, body: string, name?: string) {
  const [first] = verdicts(subject, from, body, name);
  if (first === undefined) throw new Error('no message');
  return first;
}

describe('a registry sender is read by its own parser only', () => {
  const total = rows([['Total', '$10.00']]);
  it.each([
    ['receipts@stripe.com', 'stripe'],
    ['Receipts+acct_1@MAIL.STRIPE.COM', 'stripe'],
    ['auto-confirm@amazon.com', 'amazon'],
    ['notification@facebookmail.com', 'marketplace'],
    ['reservations@opentable.com', 'opentable'],
    ['orders@instacart.com', 'instacart'],
    ['noreply@uber.com', 'uber'],
    ['store+1@t.shopifyemail.com', 'shopify'],
    ['orders@shop.example', 'generic'],
  ])('%s → %s', (from, parser) => {
    expect(one('Hello', from, total).parser).toBe(parser);
  });
});

describe('only a receipt kind is a receipt', () => {
  const total = rows([
    ['Order Total:', '$64.27'],
    ['Total', '$10.00'],
    ['Total charged', '$10.00'],
  ]);
  it.each([
    [
      'an Amazon shipping notice',
      'Your Amazon.com order of "Earbuds" has shipped!',
      'auto-confirm@amazon.com',
    ],
    ['an Amazon promotion', 'Deals picked for you', 'store-news@amazon.com'],
    ['a Stripe invoice that is not paid yet', 'Your invoice from Acme #1234', 'invoice@stripe.com'],
    ['a plain OpenTable reservation', 'Your reservation at Lantern & Ash is confirmed', 'r@opentable.com'],
    ['an Instacart refund', 'Your Instacart refund receipt', 'orders@instacart.com'],
    ['an Uber Eats order', 'Your Uber Eats order with Taqueria', 'noreply@uber.com'],
    ['a Shopify shipping notice', 'A shipment from order #1047 is on the way', 's@t.shopifyemail.com'],
    ['a Marketplace message', 'New message about your listing', 'notification@facebookmail.com'],
  ])('%s is not', (_case, subject, from) => {
    expect(one(subject, from, total).verdict).toEqual({ kind: 'none' });
  });
});

describe('what a platform receipt holds', () => {
  it('Amazon "Ordered:" uses the Grand Total and the canonical merchant', () => {
    const body = rows([
      ['Item', '$59.99'],
      ['Grand Total:', '$64.27'],
    ]);
    expect(
      one('Ordered: "Wireless Earbuds" and 1 more item', 'auto-confirm@amazon.com', body).verdict,
    ).toEqual({
      kind: 'receipt',
      facts: {
        parser: 'amazon',
        type: 'purchase.made',
        merchant: 'Amazon',
        money: { minor: 6427, currency: 'USD' },
      },
    });
  });

  it('a Stripe cancellation is a subscription change, with no amount when none is shown', () => {
    const body = paragraphs('Your plan ends on November 1.');
    expect(
      one('Your Lumen Notes subscription has been canceled', 'receipts@stripe.com', body, 'Lumen').verdict,
    ).toEqual({
      kind: 'receipt',
      facts: { parser: 'stripe', type: 'subscription.changed', merchant: 'Lumen' },
    });
  });

  it('the bracketed Stripe receipt subject is a purchase from the sender named business', () => {
    const body = rows([['Amount paid', '$49.00']]);
    const verdict = one('Your Acme receipt [#1849-2210]', 'receipts@stripe.com', body, 'Acme, Inc.').verdict;
    expect(verdict).toMatchObject({ facts: { merchant: 'Acme, Inc.', money: { minor: 4900 } } });
  });

  it('a Marketplace listing price is the row named by the item, never another amount', () => {
    const body = `${paragraphs('Boost it for $5.00.')}${rows([
      ['Listed in', 'Portland'],
      ['Oak desk', '$120'],
    ])}`;
    const verdict = one('Your listing is live: Oak desk', 'notification@facebookmail.com', body).verdict;
    expect(verdict).toMatchObject({
      facts: { type: 'listing.posted', money: { minor: 12000, currency: 'USD' } },
    });
  });

  it('amazon.ca is not in the registry: never read with a guessed currency, never generic', () => {
    expect(
      one('Your Amazon.ca order #702-1', 'auto-confirm@amazon.ca', rows([['Order Total:', '$64.27']])),
    ).toEqual(expect.objectContaining({ parser: 'generic', verdict: { kind: 'none' } }));
  });
});

describe('a recognised receipt whose total cannot be read is DEGRADED, never guessed (Hard Rules 5, 6)', () => {
  const plan = (messages: MessageSpec[], subject: string) =>
    onPage({ subject, messages }, (doc) => ({
      health: receiptObserver.health(doc),
      plan: planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
    }));

  it.each([
    ['no total line', rows([['Item Subtotal:', '$59.99']]), 'receipt.amount_missing'],
    [
      'two totals that disagree',
      rows([
        ['Order Total:', '$10.00'],
        ['Order Total:', '$12.00'],
      ]),
      'receipt.amount_ambiguous',
    ],
  ])('%s', (_case, body, reason) => {
    const result = plan([{ from: 'auto-confirm@amazon.com', body }], 'Your Amazon.com order #112-1');
    expect(result.health).toEqual({ status: 'DEGRADED', reasons: [reason] });
    expect(result.plan).toEqual({ status: 'DEGRADED', reasons: [reason], observations: [] });
  });

  it('a listing whose item row is missing', () => {
    const body = paragraphs('Boost it for $5.00.');
    const result = plan([{ from: 'notification@facebookmail.com', body }], 'Your listing is live: Oak desk');
    expect(result.health).toEqual({ status: 'DEGRADED', reasons: ['receipt.amount_missing'] });
  });
});

describe('a conversation with several messages', () => {
  const receiptBody = rows([['Total', '$23.84']]);

  it('reads every expanded message by its own id, and never a collapsed one', () => {
    const messages: MessageSpec[] = [
      { from: 'noreply@uber.com', body: receiptBody, key: '1a0000000000000a' },
      { from: 'noreply@uber.com', body: receiptBody, key: '1a0000000000000b', expanded: 'false' },
      { from: 'noreply@uber.com', body: receiptBody, key: '1a0000000000000c', expanded: null },
    ];
    const result = onPage({ subject: 'Your Thursday evening trip with Uber', messages }, (doc) =>
      planPass({ observer: receiptObserver, doc, ctx, policy: DEFAULT_POLICY }),
    );
    expect(result.status).toBe('OK_NO_COVERAGE');
    expect(result.observations).toHaveLength(2);
    expect(new Set(result.observations.map((o) => o.rowKeyHash)).size).toBe(2);
  });
});
