/**
 * The generic "order confirmation" parser (sprint_2 2.3), for senders outside the receipt-parser registry. It is
 * where false positives live (sprint_2: "a newsletter with $9.99 is not a purchase"), so the sprint's rule is only
 * its first step. A message is a generic receipt (purchase.made, confidence 0.6) only when ALL of these hold:
 *
 *  1. trigger (the sprint rule): the sender's address contains `order`, or the subject says order, receipt or
 *     confirmation (`generic.subjectTrigger`);
 *  2. the sender's display name is a plain merchant name (`plainMerchantName`, SEC-6, SEC-V2): one line of at most
 *     SCHEMA_LIMITS.MERCHANT characters, the cap `redact.project` holds every merchant to; no invisible or
 *     unrenderable character (a bidi override, a zero-width mark, private use); and plain Latin text: once
 *     diacritics are taken off (é → e), every letter is an ASCII letter. A name that mixes scripts (a Cyrillic А in
 *     "Аmazon"), is written in a script with Latin look-alikes (Cyrillic, Greek, Lisu, Cherokee) or holds a letter
 *     that can pass for an ASCII one (ɑ, ı, ø, a fullwidth or mathematical letter) is refused: telling a stand-in
 *     from a real letter needs the whole Unicode confusables table, and this parser reads English mail only (its
 *     triggers and labels are English). A merchant whose name is not Latin is missed here, never misread;
 *  3. the subject carries no refusal marker (`generic.refuseSubject`): a reply or forward, a promotion ("Order now:
 *     40% off ends tonight", "sale", "free shipping"), a cart reminder, a shipping or delivery notice, a refund,
 *     return or cancellation, a bill that is due, a statement, a quote;
 *  4. the sender does not wear a registry merchant's name (`generic.impersonationTokens` in its display name or
 *     domain: "Amazon.com <orders@shop.example>" is refused), and its address is not confusable (refused earlier,
 *     ./classify.ts);
 *  5. the body has a total line (./amounts.ts): a line whose whole label is a total label (`Amount paid`,
 *     `Amount charged`, `Total charged`, `Total paid`, `Order total`, `Grand total`, `Total`) and whose value is
 *     exactly one amount with a currency, the same in every line with that label. A price in a sentence ("from
 *     $14.99", "orders over $35") or a list of products with prices is not a total line;
 *  6. the row's other fields are ones `redact.project` accepts (`fitsRow`, SEC-V2): the subject, cut to its 80 code
 *     points, on one line with no control character, and the amount at most SCHEMA_LIMITS.AMOUNT_CENTS. A stranger
 *     writes both, and a refused field would make the whole pass DEGRADED.
 *
 * The sprint rule alone (1 plus "an amount is present") would accept the labelled negative
 * synthetic-receipt-negative-promo-order.html; 3 and 5 each refuse it. The merchant is the sender's display name
 * (Decisions [2.1/2.4]). A message that fails any step is simply not a receipt: the generic parser never makes a
 * pass DEGRADED (a stranger's mail must never void a real receipt's coverage beside it), because most mail that
 * mentions an order is not one; for the same reason a generic receipt whose date names no single minute is dropped,
 * not refused (./extract.ts). Anyone can send such mail, so a generic receipt is evidence for a claim and never
 * coverage (./extract.ts `receiptWindows`, SEC-6): no pass posts a coverage point for it (Hard Rule 7). Rows carry
 * no parser, so the point of a registry receipt read in another pass in the same minute can still hold it and make
 * it an orphan (a known limit, docs/attacks-that-work.md).
 */
import { asciiLower, nameTokens } from '../../../core/normalize';
import { clampSubjectHint } from '../../../core/redact';
import { AmountCents, SCHEMA_LIMITS } from '../../../core/schema';
import { oneLineText } from '../../../core/schema-text';
import { findTotal } from './amounts';
import type { MessageView } from './message';
import { NOT_A_RECEIPT, receipt, type ReceiptParser, type Verdict } from './parser';
import { RECEIPT_SELECTORS } from './selectors';

const RULES = RECEIPT_SELECTORS.generic;

/** The check `redact.project` applies to every merchant: one line, at most SCHEMA_LIMITS.MERCHANT characters. */
const MERCHANT_TEXT = oneLineText(SCHEMA_LIMITS.MERCHANT);
/** The check `redact.project` applies to a subject hint, once cut to SCHEMA_LIMITS.SUBJECT_HINT code points. */
const SUBJECT_TEXT = oneLineText(SCHEMA_LIMITS.SUBJECT_HINT);
/** Characters plain text never holds: format (bidi, zero-width), private-use and lone surrogate code points. */
const NOT_PLAIN = /[\p{Cf}\p{Co}\p{Cs}]/u;
const COMBINING_MARK = /\p{Mn}/gu;
/** A letter that is not an ASCII letter. */
const NON_ASCII_LETTER = /(?![A-Za-z])\p{L}/u;

/** Step 2: `name` is one clean line of plain Latin text (header). */
export function plainMerchantName(name: string): boolean {
  if (!MERCHANT_TEXT.safeParse(name).success || NOT_PLAIN.test(name)) return false;
  return !NON_ASCII_LETTER.test(name.normalize('NFD').replace(COMBINING_MARK, ''));
}

/** True when the display name or the sender's domain carries a registry merchant's name. */
function impersonates(message: MessageView, domain: string): boolean {
  const tokens = [...nameTokens(message.senderName), ...asciiLower(domain).split(/[.-]/u)];
  return tokens.some((token) => RULES.impersonationTokens.has(token));
}

function triggered(message: MessageView, address: string): boolean {
  return asciiLower(address).includes(RULES.senderTrigger) || RULES.subjectTrigger.test(message.subject);
}

/** Step 6: the subject and the amount (minor units) are fields `redact.project` accepts (header). */
function fitsRow(subject: string, minor: number): boolean {
  return SUBJECT_TEXT.safeParse(clampSubjectHint(subject)).success && AmountCents.safeParse(minor).success;
}

function parseGeneric(message: MessageView): Verdict {
  const sender = message.sender;
  if (sender === null || !triggered(message, sender.address)) return NOT_A_RECEIPT;
  if (!plainMerchantName(message.senderName)) return NOT_A_RECEIPT;
  if (RULES.refuseSubject.test(message.subject) || impersonates(message, sender.domain)) return NOT_A_RECEIPT;
  const total = findTotal(message.lines(), RULES.labels, RULES.defaultDollar);
  if (total.kind !== 'found' || !fitsRow(message.subject, total.money.minor)) return NOT_A_RECEIPT;
  return receipt('generic', 'purchase.made', {
    merchant: message.senderName,
    money: total.money,
    confidence: RULES.confidence,
  });
}

export const generic: ReceiptParser = Object.freeze({ id: 'generic', parse: parseGeneric });
