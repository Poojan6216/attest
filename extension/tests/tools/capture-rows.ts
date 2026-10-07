/**
 * Card endings and order numbers that a receipt shows in a table row, beside the words that say what they are, and
 * that no pattern of ./capture-pii.ts sees in a single text node (review of the receipt captures, 2026-10-07: Stripe's
 * receipt puts "Payment method" in one cell and the card's brand, an image's alt text, with "- 5454" in the next, and
 * an invoice number whose prefix is the customer's beside "Invoice number"). Read before the page is scrubbed, on rows
 * that hold no other row:
 *  - a card's ending: a text that is only 4 or 5 digits (with a mask or separators) in a row whose text or image alt
 *    names a payment method, a card, a card brand or an ending is faked like a card;
 *  - an order number: in a row whose first cell is a label (`Order number`, `Receipt #`, `Invoice number`,
 *    `Confirmation code`, …), every word of the other cells that holds a digit; and beside any element whose whole
 *    text is such a label or a code's (`Copy code:`, `Referral code`: Instacart writes the customer's referral code
 *    in a span after "Copy code:"; Spotify writes "Invoice ID" in a row of its own, the id in the next), every such
 *    word of the next element with text. Each is faked in its own shape, and the fake replaces it wherever it stands
 *    alone on the page, in text and attributes (the subject, the list's row), also where a `<wbr>` splits it in two
 *    (Gmail breaks a long word with one), so the page reads the same everywhere;
 *  - a label and its value in one text (`Code ABCDE12FG3HI`, `Order Confirmation #1ABCDEF`): the value, when it
 *    holds a digit, is an order number like the ones above;
 *  - a postal address: every text of the first element with text after one whose whole text labels an address
 *    (`Shipping address`, `Billing address`, `Ship to`, …) becomes a neutral phrase of as many words. A Shopify order
 *    writes the recipient's name and address after an `<h4>Shipping address</h4>`, in a format (an Indian one) that
 *    the street-address pattern of ./capture-pii.ts does not know.
 */
import type { Document, Element, Text } from 'happy-dom';

import { textNodes } from './capture-dom';
import type { Faker } from './capture-fakes';

/** What makes a row a card's: a payment method, a card or its brand, or its ending. */
const CARD_ROW =
  /\b(?:payment\s+method|card|visa|mastercard|master\s+card|amex|american\s+express|discover|jcb|diners|maestro|unionpay|rupay|ending|ends\s+in|last\s+(?:4|four|5|five))\b/iu;
/** A text that is only a card's ending: 4 or 5 digits, with at most a mask, a dash or brackets around them. */
const BARE_ENDING = /^[\s\u00a0\-–—•·●*xX#:()]*\d{4,5}[\s\u00a0)]*$/u;
/** A text that labels an order number, or a code (a referral, promo or gift code is the customer's). */
const ID_LABEL =
  /^\s*(?:your\s+)?(?:(?:order|receipt|invoice|confirmation|booking|reservation|reference|ref\.?|transaction|customer|account|membership|member|ticket|tracking|shipment)(?:\s+(?:number|no\.?|num\.?|#|id|code|reference))?|(?:(?:copy|promo|promotion|referral|invite|invitation|coupon|discount|gift(?:\s+card)?|share|redeem)\s+)?code)\s*[:#]?\s*$/iu;
/** A word of a labelled value: letters and digits, joined by `-` or `/`. One that holds a digit is an order number. */
const ID_WORD = /[\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)*/gu;
const MIN_ID_LENGTH = 4;
/**
 * A label and its value in one text: `Code ABCDE12FG3HI` (a coupon code Gap makes for each customer), `Order
 * Confirmation #1ABCDEF`, `Order 54321 confirmed`. The value (group 1) is an order number only if it holds a digit.
 */
const INLINE_ID =
  /(?<![\p{L}\p{N}])(?:(?:promo|promotion|coupon|discount|referral|invite|gift|offer)\s+)?(?:code|order|receipt|invoice|confirmation|booking|reservation)(?:\s+(?:order|receipt|invoice|confirmation|code|number|no\.?|id|#))*\s*[:#]?\s*#?\s*([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)/giu;

/** A text that labels a postal address: a receipt's shipping, billing or delivery address. */
const ADDRESS_LABEL =
  /^\s*(?:(?:shipping|billing|delivery|mailing|pickup|pick-up|drop-?off|home|work)\s+address|address|ship(?:ping)?\s+to|bill(?:ing)?\s+to|deliver(?:y|ed)?\s+to|sold\s+to)\s*:?\s*$/iu;
/** Attributes that never carry an order number to replace. */
const SKIPPED_ATTRIBUTES = new Set(['class', 'style']);

/** The counters this module adds to (./sanitize.ts SanitizeStats). */
export interface RowStats {
  rowCards: number;
  rowIds: number;
  rowAddresses: number;
}

const ownText = (element: Element): string => element.textContent.replace(/\s+/gu, ' ').trim();

/**
 * A row's texts and its images' alt texts (where a card's brand often is), one space between each: cells hold no
 * space between them, so a row's `textContent` reads "Payment methodVisa".
 */
function rowWords(row: Element): string {
  const texts = textNodes(row).map((node) => node.data);
  const alts = Array.from(row.querySelectorAll('img[alt]'), (img) => img.getAttribute('alt'));
  return [...texts, ...alts].join(' ');
}

/** The words of `text` that are order numbers: 4 or more characters, a digit among them. */
const idWords = (text: string): string[] =>
  (text.match(ID_WORD) ?? []).filter((word) => word.length >= MIN_ID_LENGTH && /\d/u.test(word));

/** The order numbers in the value cells of a labelled row. */
function rowIds(row: Element): string[] {
  const cells = Array.from(row.children).filter((cell) => cell.localName === 'td' || cell.localName === 'th');
  const [label, ...values] = cells;
  if (label === undefined || !ID_LABEL.test(ownText(label))) return [];
  return values.flatMap((cell) => idWords(ownText(cell)));
}

/**
 * The page's text nodes in runs: nodes that only a `<wbr>` splits form one run (Gmail breaks a long word with it,
 * and an id split in two must still be found whole).
 */
function textRuns(doc: Document): Text[][] {
  const runs: Text[][] = [];
  for (const node of textNodes(doc)) {
    const last = runs[runs.length - 1];
    const previous = last?.[last.length - 1];
    const between = previous?.nextSibling;
    if (last !== undefined && between?.nodeName === 'WBR' && between.nextSibling === node) last.push(node);
    else runs.push([node]);
  }
  return runs;
}

/** An element's next sibling element, null after the last one (happy-dom types it as always there). */
const nextSibling = (element: Element): Element | null => element.nextElementSibling;

/** The order numbers of the first element with text after `label`, an element whose whole text is a label. */
function besideIds(label: Element): string[] {
  if (!ID_LABEL.test(ownText(label))) return [];
  const next = nextWithText(label);
  return next === null ? [] : idWords(ownText(next));
}

/** The first element with text after `element`, or null. */
function nextWithText(element: Element): Element | null {
  let next = nextSibling(element);
  while (next !== null && ownText(next) === '') next = nextSibling(next);
  return next;
}

/** Turns every text of the element after an address label into a neutral phrase of as many words. */
function fakeAddresses(doc: Document, faker: Faker, stats: RowStats): void {
  for (const label of Array.from(doc.querySelectorAll('body *'))) {
    if (!ADDRESS_LABEL.test(ownText(label))) continue;
    const block = nextWithText(label);
    if (block === null) continue;
    for (const node of textNodes(block)) {
      if (node.data.trim() === '') continue;
      node.data = faker.phrase(node.data);
      stats.rowAddresses += 1;
    }
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fakes the card endings and order numbers of `doc`'s table rows in place (module comment), and returns how many of
 * each it faked. The same real value always gets the same fake (`faker` is the capture's).
 */
export function fakeRowValues(doc: Document, faker: Faker, stats: RowStats): void {
  fakeAddresses(doc, faker, stats);
  const ids = new Map<string, string>();
  for (const label of Array.from(doc.querySelectorAll('body *'))) {
    for (const id of besideIds(label)) if (!ids.has(id)) ids.set(id, faker.identifier(id));
  }
  for (const run of textRuns(doc)) {
    for (const match of run
      .map((node) => node.data)
      .join('')
      .matchAll(INLINE_ID)) {
      for (const id of idWords(match[1] ?? '')) if (!ids.has(id)) ids.set(id, faker.identifier(id));
    }
  }
  for (const row of Array.from(doc.querySelectorAll('tr'))) {
    if (row.querySelector('tr') !== null) continue;
    for (const id of rowIds(row)) if (!ids.has(id)) ids.set(id, faker.identifier(id));
    if (!CARD_ROW.test(rowWords(row))) continue;
    for (const node of textNodes(row)) {
      if (!BARE_ENDING.test(node.data)) continue;
      node.data = node.data.replace(/\d{4,5}/u, (digits) => faker.card(digits));
      stats.rowCards += 1;
    }
  }
  if (ids.size === 0) return;
  const sources = [...ids.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${sources.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  const replace = (value: string): string =>
    value.replace(pattern, (id) => {
      stats.rowIds += 1;
      return ids.get(id) ?? id;
    });
  for (const run of textRuns(doc)) {
    const joined = run.map((node) => node.data).join('');
    const replaced = replace(joined);
    if (replaced === joined) continue;
    // A fake keeps its id's length, so each node keeps its own length and the run splits where it did.
    let at = 0;
    for (const node of run) {
      const length = node.data.length;
      node.data = replaced.slice(at, at + length);
      at += length;
    }
  }
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value;
      if (value === null || SKIPPED_ATTRIBUTES.has(attribute.name)) continue;
      const replaced = replace(value);
      if (replaced !== value) element.setAttribute(attribute.name, replaced);
    }
  }
}
