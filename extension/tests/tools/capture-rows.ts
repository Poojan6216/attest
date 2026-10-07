/**
 * Card endings and order numbers that a receipt shows in a table row, beside the words that say what they are, and
 * that no pattern of ./capture-pii.ts sees in a single text node (review of the receipt captures, 2026-10-07: Stripe's
 * receipt puts "Payment method" in one cell and the card's brand, an image's alt text, with "- 5454" in the next, and
 * an invoice number whose prefix is the customer's beside "Invoice number"). Read before the page is scrubbed, on rows
 * that hold no other row:
 *  - a card's ending: a text that is only 4 or 5 digits (with a mask or separators) in a row whose text or image alt
 *    names a payment method, a card, a card brand or an ending is faked like a card;
 *  - an order number: in a row whose first cell is a label (`Order number`, `Receipt #`, `Invoice number`,
 *    `Confirmation code`, …), every word of the other cells that holds a digit is faked in its own shape, and the fake
 *    replaces it wherever it stands alone on the page, in text and attributes (the subject, the list's row), so the
 *    page reads the same everywhere.
 */
import type { Document, Element } from 'happy-dom';

import { textNodes } from './capture-dom';
import type { Faker } from './capture-fakes';

/** What makes a row a card's: a payment method, a card or its brand, or its ending. */
const CARD_ROW =
  /\b(?:payment\s+method|card|visa|mastercard|master\s+card|amex|american\s+express|discover|jcb|diners|maestro|unionpay|rupay|ending|ends\s+in|last\s+(?:4|four|5|five))\b/iu;
/** A text that is only a card's ending: 4 or 5 digits, with at most a mask, a dash or brackets around them. */
const BARE_ENDING = /^[\s\u00a0\-–—•·●*xX#:()]*\d{4,5}[\s\u00a0)]*$/u;
/** A first cell that labels an order number. */
const ID_LABEL =
  /^\s*(?:your\s+)?(?:order|receipt|invoice|confirmation|booking|reservation|reference|ref\.?|transaction|customer|account|membership|member|ticket|tracking|shipment)(?:\s+(?:number|no\.?|num\.?|#|id|code|reference))?\s*[:#]?\s*$/iu;
/** A word of a labelled value: letters and digits, joined by `-` or `/`. One that holds a digit is an order number. */
const ID_WORD = /[\p{L}\p{N}]+(?:[-/][\p{L}\p{N}]+)*/gu;
const MIN_ID_LENGTH = 4;
/** Attributes that never carry an order number to replace. */
const SKIPPED_ATTRIBUTES = new Set(['class', 'style']);

/** The counters this module adds to (./sanitize.ts SanitizeStats). */
export interface RowStats {
  rowCards: number;
  rowIds: number;
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

/** The order numbers in the value cells of a labelled row. */
function rowIds(row: Element): string[] {
  const cells = Array.from(row.children).filter((cell) => cell.localName === 'td' || cell.localName === 'th');
  const [label, ...values] = cells;
  if (label === undefined || !ID_LABEL.test(ownText(label))) return [];
  return values
    .flatMap((cell) => ownText(cell).match(ID_WORD) ?? [])
    .filter((word) => word.length >= MIN_ID_LENGTH && /\d/u.test(word));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fakes the card endings and order numbers of `doc`'s table rows in place (module comment), and returns how many of
 * each it faked. The same real value always gets the same fake (`faker` is the capture's).
 */
export function fakeRowValues(doc: Document, faker: Faker, stats: RowStats): void {
  const ids = new Map<string, string>();
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
  for (const node of textNodes(doc)) {
    const replaced = replace(node.data);
    if (replaced !== node.data) node.data = replaced;
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
