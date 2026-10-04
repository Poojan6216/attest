/**
 * The generic order-confirmation parser (sprint_2 2.3; src/observers/gmail/receipts/generic.ts). Receipt parsers
 * are where false positives live: a message with prices is not a purchase unless it states a charged total. The
 * sprint's own rule (a trigger word plus any amount) is only step one, and these cases prove the tightened rule on
 * synthetic pages beyond the labelled fixtures: positives in several shapes, and negatives that each pass the
 * sprint rule yet must stay unparsed (Hard Rule 5).
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { amount } from '../../../../src/core/normalize';
import { findTotal } from '../../../../src/observers/gmail/receipts/amounts';
import { readPage } from '../../../../src/observers/gmail/receipts/message';
import { RECEIPT_SELECTORS, receiptVerdicts } from '../../../../src/observers/gmail/receipts';
import { ACCOUNT, onPage, paragraphs, rows } from './message-page';
import { gmailFixtures, withPage } from './receipt-fixtures';

const verdictOf = (subject: string, from: string, body: string, name = 'Corner Shop') =>
  onPage({ subject, messages: [{ from, name, body }] }, (doc) => receiptVerdicts(doc));

const facts = (subject: string, from: string, body: string, name?: string) => {
  const [first] = verdictOf(subject, from, body, name);
  return first?.verdict.kind === 'receipt' ? first.verdict.facts : null;
};

describe('generic positives', () => {
  it.each([
    [
      'a total row',
      'Your receipt',
      rows([
        ['Latte', '$4.50'],
        ['Total', '$12.34'],
      ]),
      1234,
      'USD',
    ],
    ['a one-line total with a colon', 'Order confirmation', paragraphs('Total: €9,99'), 999, 'EUR'],
    [
      'a <br> line in a paragraph',
      'Your receipt',
      '<p>Subtotal $10.00<br><b>Total</b> $11.50</p>',
      1150,
      'USD',
    ],
    [
      'an explicit currency code',
      'Booking confirmation',
      rows([['Amount charged:', 'CA$95.00']]),
      9500,
      'CAD',
    ],
    [
      'the preferred label',
      'Your receipt',
      rows([
        ['Total', '$5.00'],
        ['Amount paid', '$5.00'],
      ]),
      500,
      'USD',
    ],
    ['a sender that says order', 'Thanks for shopping', rows([['Order total', '$20.00']]), 2000, 'USD'],
  ])('%s', (_case, subject, body, minor, currency) => {
    const from =
      subject === 'Thanks for shopping' ? 'orders@corner-shop.example' : 'hello@corner-shop.example';
    expect(facts(subject, from, body)).toEqual({
      parser: 'generic',
      type: 'purchase.made',
      merchant: 'Corner Shop',
      money: { minor, currency },
      confidence: RECEIPT_SELECTORS.generic.confidence,
    });
  });

  it('declares confidence 0.6, which is never sent: an Observation has no confidence field', () => {
    expect(RECEIPT_SELECTORS.generic.confidence).toBe(0.6);
  });
});

describe('generic negatives that pass the sprint rule (a trigger word and an amount) and must stay unparsed', () => {
  const total = rows([['Total', '$49.99']]);
  it.each([
    ['a promotion, even with a total row', 'Order now: 40% off ends tonight', total],
    ['a cart reminder', 'Complete your order: items left in your cart', total],
    ['a refund', 'Your refund receipt', rows([['Total refunded', '$20.00']])],
    ['a bill that is due', 'Order #123 confirmation: payment due', total],
    ['a forward of a receipt', 'Fwd: Your receipt from Pinecone Bakery', total],
    ['a reply', 'Re: your order receipt', total],
    ['a shipping notice with the order total', 'Your order has shipped', total],
    ['a label that is not a total', 'Your order receipt', rows([['Total due', '$50.00']])],
    ['a price in a sentence', 'Your order receipt', paragraphs('You paid a total of $12.00 today.')],
    [
      'prices with no total line',
      'Order confirmation',
      rows([
        ['Mug', '$9.99'],
        ['Hat', '$19.00'],
      ]),
    ],
    ['a total with words around the amount', 'Your receipt', rows([['Total', '$10.00 (incl. tax)']])],
    ['a total with no currency', 'Your receipt', rows([['Total', '12.00']])],
    [
      'two totals that disagree',
      'Your receipt',
      rows([
        ['Total', '$10.00'],
        ['Total', '$12.00'],
      ]),
    ],
  ])('%s', (_case, subject, body) => {
    expect(verdictOf(subject, 'orders@corner-shop.example', body).map((v) => v.verdict)).toEqual([
      { kind: 'none' },
    ]);
  });
});

describe('the trigger (the sprint rule): a sender with "order" or a subject with order, receipt, confirmation', () => {
  it('a message with a total row but no trigger word in its sender or subject is not a receipt', () => {
    const body = rows([['Total', '$49.99']]);
    const [verdict] = verdictOf('The Weekend Edit: 12 picks under $50', 'news@corner-shop.example', body);
    expect(verdict?.verdict).toEqual({ kind: 'none' });
  });
});

describe('who may be a generic sender', () => {
  const body = rows([['Total', '$499.00']]);

  it.each([
    ['a display name wearing a registry merchant', 'orders@shop.example', 'Amazon.com'],
    ['a domain wearing a registry merchant', 'orders@amazon-billing.example', 'Billing'],
    ['a lookalike of a registry domain', 'receipts@stripe.com.pay.example', 'Acme'],
  ])('%s is refused', (_case, from, name) => {
    expect(facts('Your order confirmation', from, body, name)).toBeNull();
  });

  it('a confusable address (a Cyrillic i in stripe.com) has no parser at all', () => {
    const [verdict] = verdictOf('Your receipt from Acme', 'receipts@strіpe.com', body, 'Acme');
    expect(verdict).toMatchObject({ parser: null, verdict: { kind: 'none' } });
  });

  it('mail the signed-in account sent itself (a sent thread, a forward) has no parser', () => {
    const [verdict] = verdictOf('Your receipt', ACCOUNT.toUpperCase(), body, 'Avery Founder');
    expect(verdict).toMatchObject({ parser: null, verdict: { kind: 'none' } });
  });

  it('a registry domain is never handed to the generic parser, even with a generic-looking receipt', () => {
    const [verdict] = verdictOf('Order confirmation', 'store-news@amazon.com', body, 'Amazon.com');
    expect(verdict).toMatchObject({ parser: 'amazon', verdict: { kind: 'none' } });
  });
});

describe('the labelled promotion fixture: the sprint rule accepts it, the tightened rule refuses it twice', () => {
  const [f] = gmailFixtures().filter((x) => x.file === 'synthetic-receipt-negative-promo-order.html');

  it('passes the sprint rule (subject says order, an amount is present) yet fails both added guards', () => {
    if (f === undefined) throw new Error('fixture missing');
    withPage(readFileSync(f.htmlPath, 'utf8'), f.page.liveUrl, (doc) => {
      const [message] = readPage(doc).messages;
      if (message === undefined) throw new Error('no message');
      const rules = RECEIPT_SELECTORS.generic;
      const cells = [...message.lines()].flatMap((line) => line.cells);
      const amounts = cells.flatMap((cell) => cell.match(/\$\d+(?:\.\d\d)?/gu) ?? []);
      expect(rules.subjectTrigger.test(message.subject)).toBe(true);
      expect(amounts.some((token) => amount(token, { defaultDollar: 'USD' }) !== null)).toBe(true);
      expect(rules.refuseSubject.test(message.subject)).toBe(true);
      expect(findTotal(message.lines(), rules.labels, rules.defaultDollar)).toEqual({ kind: 'missing' });
    });
  });
});
