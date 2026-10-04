/**
 * The generic "order confirmation" parser (sprint_2 2.3), for senders outside the receipt-parser registry. It is
 * where false positives live (sprint_2: "a newsletter with $9.99 is not a purchase"), so the sprint's rule is only
 * its first step. A message is a generic receipt (purchase.made, confidence 0.6) only when ALL of these hold:
 *
 *  1. trigger (the sprint rule): the sender's address contains `order`, or the subject says order, receipt or
 *     confirmation (`generic.subjectTrigger`);
 *  2. the subject carries no refusal marker (`generic.refuseSubject`): a reply or forward, a promotion ("Order now:
 *     40% off ends tonight", "sale", "free shipping"), a cart reminder, a shipping or delivery notice, a refund,
 *     return or cancellation, a bill that is due, a statement, a quote;
 *  3. the body has a total line (./amounts.ts): a line whose whole label is a total label (`Amount paid`,
 *     `Amount charged`, `Total charged`, `Total paid`, `Order total`, `Grand total`, `Total`) and whose value is
 *     exactly one amount with a currency, the same in every line with that label. A price in a sentence ("from
 *     $14.99", "orders over $35") or a list of products with prices is not a total line;
 *  4. the sender does not wear a registry merchant's name (`generic.impersonationTokens` in its display name or
 *     domain: "Amazon.com <orders@shop.example>" is refused), and its address is not confusable (refused earlier,
 *     ./classify.ts).
 *
 * The sprint rule alone (1 plus "an amount is present") would accept the labelled negative
 * synthetic-receipt-negative-promo-order.html; 2 and 3 each refuse it. The merchant is the sender's display name
 * (Decisions [2.1/2.4]). A message that fails any step is simply not a receipt: the generic parser never makes a
 * pass DEGRADED, because most mail that mentions an order is not one.
 */
import { asciiLower, nameTokens } from '../../../core/normalize';
import { findTotal } from './amounts';
import type { MessageView } from './message';
import { NOT_A_RECEIPT, receipt, type ReceiptParser, type Verdict } from './parser';
import { RECEIPT_SELECTORS } from './selectors';

const RULES = RECEIPT_SELECTORS.generic;

/** True when the display name or the sender's domain carries a registry merchant's name. */
function impersonates(message: MessageView, domain: string): boolean {
  const tokens = [...nameTokens(message.senderName), ...asciiLower(domain).split(/[.-]/u)];
  return tokens.some((token) => RULES.impersonationTokens.has(token));
}

function triggered(message: MessageView, address: string): boolean {
  return asciiLower(address).includes(RULES.senderTrigger) || RULES.subjectTrigger.test(message.subject);
}

function parseGeneric(message: MessageView): Verdict {
  const sender = message.sender;
  if (sender === null || !triggered(message, sender.address)) return NOT_A_RECEIPT;
  if (RULES.refuseSubject.test(message.subject) || impersonates(message, sender.domain)) return NOT_A_RECEIPT;
  const total = findTotal(message.lines(), RULES.labels, RULES.defaultDollar);
  if (total.kind !== 'found') return NOT_A_RECEIPT;
  return receipt('generic', 'purchase.made', {
    merchant: message.senderName,
    money: total.money,
    confidence: RULES.confidence,
  });
}

export const generic: ReceiptParser = Object.freeze({ id: 'generic', parse: parseGeneric });
