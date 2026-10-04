/**
 * Generic subjects that pass the sprint rule, carry a total line, and are still not purchases (sprint_2 2.3: "receipt
 * parsers are where false positives live"; 2.3 verification). Each refusal family in selectors.json
 * `generic.refuseSubject` is pinned here: a cart reminder, an order still to confirm, a payment that failed or
 * waits, a shipping notice, a marketing mail, a review request, an update or an invoice. Any of them read as a
 * purchase would let a failed or abandoned order verify an agent's claim (Hard Rule 5). The real confirmations
 * beside them stay receipts.
 */
import { describe, expect, it } from 'vitest';

import { receiptVerdicts } from '../../../../src/observers/gmail/receipts';
import { onPage, rows } from './message-page';

const total = rows([['Total', '$49.99']]);

function kindOf(subject: string): string | undefined {
  const page = {
    subject,
    messages: [{ from: 'hello@corner-shop.example', name: 'Corner Shop', body: total }],
  };
  return onPage(page, (doc) => receiptVerdicts(doc))[0]?.verdict.kind;
}

describe('not a purchase, whatever the total line says', () => {
  it.each([
    ['a cart reminder', 'Complete your order'],
    ['a cart reminder', 'Your order is waiting'],
    ['a cart reminder', "Don't forget your order"],
    ['a cart reminder', 'Your order is almost complete'],
    ['an order still to confirm', 'Please confirm your order'],
    ['a payment that failed', 'Payment failed for your order'],
    ['a payment that failed', 'Your order could not be processed'],
    ['a payment that waits', 'Order confirmation - payment pending'],
    ['a payment that waits', 'Your order is on hold'],
    ['a payment that waits', 'Action required: your order'],
    ['a shipping notice', 'Shipping confirmation for order #123'],
    ['a shipping notice', 'Your order has been dispatched'],
    ['a pickup notice', 'Your order is ready for pickup'],
    ['marketing', 'Your weekly picks: order before Friday'],
    ['marketing', 'Last call: your order expires'],
    ['marketing', 'Re-order your favourites'],
    ['a review request', 'Rate your recent order'],
    ['a review request', 'How was your order?'],
    ['an update of an order already confirmed', 'Your order has been updated'],
    ['an invoice (a bill, maybe unpaid)', 'Your invoice for order #123'],
  ])('%s: "%s"', (_family, subject) => {
    expect(kindOf(subject)).toBe('none');
  });
});

describe('real confirmations stay receipts', () => {
  it.each([
    'Your order receipt',
    'Order #123 confirmation',
    'Order confirmation #A-20931',
    'Pre-order confirmation',
    'Your gift card order receipt',
    'Your Order Has Been Received',
    'Booking confirmation – Harbor Kayak Rentals',
    'Your receipt from Pinecone Bakery',
  ])('"%s"', (subject) => {
    expect(kindOf(subject)).toBe('receipt');
  });
});
