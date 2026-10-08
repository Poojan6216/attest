/**
 * Card endings and order numbers that a receipt shows in a table row, beside the words that say what they are, and
 * that no pattern of ./capture-pii.ts sees in a single text node (review of the receipt captures, 2026-10-07: Stripe's
 * receipt puts "Payment method" in one cell and the card's brand, an image's alt text, with a dash and the last four
 * digits in the next, and an invoice number whose prefix is the customer's beside "Invoice number"). Read before the
 * page is scrubbed, on rows that hold no other row:
 *  - a card's ending: a text that is only 4 or 5 digits (with a mask or separators) in a row whose text or image alt
 *    names a payment method, a card, a card brand or an ending is faked like a card;
 *  - an order number: in a row whose first cell is a label (`Order number`, `Receipt #`, `Invoice number`,
 *    `Confirmation code`, …), every word of 4 or more characters with a digit in the other cells; and beside any
 *    element whose whole text is such a label or a code's (`Copy code:`, `Referral code`: Instacart writes the
 *    customer's referral code in a span after "Copy code:"; Spotify writes "Invoice ID" in a row of its own, the id in
 *    the next), every such word of the next element with text. Each is faked in its own shape, and the fake replaces
 *    it wherever it stands alone on the page, in text and attributes (the subject, the list's row), also where a
 *    `<wbr>` splits it in two (Gmail breaks a long word with one), so the page reads the same everywhere;
 *  - a label and its value in one text (`Code ABCDE12FG3HI`, `Tracking number 1Z999AA10123456784`; values invented):
 *    the value, when it is 4 or more characters with a digit, is an order number like the ones above;
 *  - a Google Meet code (`abc-defg-hij`, the key to a meeting) in a text or label that names Meet, and on a Calendar
 *    page (`meetEverywhere`) every Meet-shaped code, since an event's code also stands where nothing names Meet;
 *  - a UUID in an attribute (a sender's id: Uber names a trip's map image after one; security review SEC-L3), never in
 *    Gmail's own `data-legacy-*` ids, which the observers read;
 *  - a postal address: every text of the blocks after one whose whole text labels an address (`Shipping address`,
 *    `Billing address`, `Ship to`, …), up to the next heading, label, table or amount, becomes a neutral phrase of as
 *    many words. A Shopify order writes the recipient's name and address after an `<h4>Shipping address</h4>`, in a
 *    format (an Indian one) that the street-address pattern of ./capture-pii.ts does not know.
 */
import type { Document, Element, Text } from 'happy-dom';

import { textNodes } from './capture-dom';
import type { Faker } from './capture-fakes';
import { escapeRegExp, holdsMoney } from './capture-pii';

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
 * A label and its value in one text: `Code ABCDE12FG3HI` (a coupon code a shop makes for each customer), `Order
 * Confirmation #1ABCDEF`, `Booking reference: AB12CD`, `Tracking number 1Z999AA10123456784` (values invented). The
 * nouns are ID_LABEL's (security review SEC-L4). The value (group 1) is an order number only if it holds a digit.
 */
const INLINE_ID =
  /(?<![\p{L}\p{N}])(?:(?:promo|promotion|coupon|discount|referral|invite|gift|offer)\s+)?(?:code|order|receipt|invoice|confirmation|booking|reservation|reference|tracking|ticket|membership|member|account|customer|transaction|shipment)(?:\s+(?:order|receipt|invoice|confirmation|code|number|no\.?|id|#|reference))*\s*[:#]?\s*#?\s*([\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*)/giu;

/** A Google Meet code (`abc-defg-hij`): the key to a meeting, faked where a text or label names Meet. */
const MEET_CODE = /(?<![\p{L}\p{N}-])[a-z]{3}-[a-z]{4}-[a-z]{3}(?![\p{L}\p{N}-])/gu;
/** A UUID (8-4-4-4-12 hex digits) in an attribute: a sender's id (SEC-L3). */
const UUID =
  /(?<![\p{L}\p{N}])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\p{L}\p{N}])/giu;
/** The prefix of Gmail's ids the observers read (`data-legacy-thread-id`, …): never faked. */
const OBSERVER_IDS = 'data-legacy-';
/** The most blocks an address runs over after its label: name, street lines, city, country. */
const MAX_ADDRESS_BLOCKS = 6;

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

/** What the page is (./sanitize.ts reads it from the page address). */
export interface RowOptions {
  /** A Google Calendar page: every Meet-shaped code is an event's, faked wherever it stands (SEC-L4). */
  readonly meetEverywhere?: boolean;
}

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

/** Every attribute value of the page an id can be replaced in, with its attribute's name. */
function attributeValues(doc: Document): { name: string; value: string }[] {
  return Array.from(doc.querySelectorAll('*')).flatMap((element) =>
    Array.from(element.attributes).flatMap((attribute) =>
      attribute.value === null || SKIPPED_ATTRIBUTES.has(attribute.name)
        ? []
        : [{ name: attribute.name, value: attribute.value }],
    ),
  );
}

/** The texts a Meet code is faked in: those naming Meet, or on a Calendar page every text and attribute. */
function meetTexts(doc: Document, options: RowOptions): string[] {
  const texts = textRuns(doc).map((run) => run.map((node) => node.data).join(''));
  const values = [...texts, ...attributeValues(doc).map((attribute) => attribute.value)];
  return options.meetEverywhere === true ? values : values.filter((value) => /meet/iu.test(value));
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

/** Where an address's blocks end: a heading, a table, a label (an address's, an id's, any `…:`), or an amount. */
function endsAddress(block: Element): boolean {
  const text = ownText(block);
  return (
    /^h[1-6]$/u.test(block.localName) ||
    block.localName === 'table' ||
    block.querySelector('table') !== null ||
    ADDRESS_LABEL.test(text) ||
    ID_LABEL.test(text) ||
    text.endsWith(':') ||
    holdsMoney(text)
  );
}

/** Turns every text of the blocks after an address label into neutral phrases of as many words (module comment). */
function fakeAddresses(doc: Document, faker: Faker, stats: RowStats): void {
  for (const label of Array.from(doc.querySelectorAll('body *'))) {
    if (!ADDRESS_LABEL.test(ownText(label))) continue;
    let block = nextWithText(label);
    for (let count = 0; block !== null && count < MAX_ADDRESS_BLOCKS && !endsAddress(block); count += 1) {
      for (const node of textNodes(block)) {
        if (node.data.trim() === '') continue;
        node.data = faker.phrase(node.data);
        stats.rowAddresses += 1;
      }
      block = nextWithText(block);
    }
  }
}

/** Fakes, in place, every bare card ending of a row that names a card (module comment). */
function fakeRowCards(doc: Document, faker: Faker, stats: RowStats): void {
  for (const row of Array.from(doc.querySelectorAll('tr'))) {
    if (row.querySelector('tr') !== null || !CARD_ROW.test(rowWords(row))) continue;
    for (const node of textNodes(row)) {
      if (!BARE_ENDING.test(node.data)) continue;
      node.data = node.data.replace(/\d{4,5}/u, (digits) => faker.card(digits));
      stats.rowCards += 1;
    }
  }
}

/** Every order number, code and attribute UUID of the page (module comment), each with its fake. */
function collectIds(doc: Document, faker: Faker, options: RowOptions): Map<string, string> {
  const found: string[] = [];
  for (const label of Array.from(doc.querySelectorAll('body *'))) found.push(...besideIds(label));
  for (const value of meetTexts(doc, options)) found.push(...(value.match(MEET_CODE) ?? []));
  for (const run of textRuns(doc)) {
    const text = run.map((node) => node.data).join('');
    for (const match of text.matchAll(INLINE_ID)) found.push(...idWords(match[1] ?? ''));
  }
  for (const row of Array.from(doc.querySelectorAll('tr'))) {
    if (row.querySelector('tr') === null) found.push(...rowIds(row));
  }
  const ids = new Map<string, string>();
  for (const attribute of attributeValues(doc)) {
    if (attribute.name.startsWith(OBSERVER_IDS)) continue;
    for (const uuid of attribute.value.match(UUID) ?? []) if (!ids.has(uuid)) ids.set(uuid, faker.uuid(uuid));
  }
  for (const id of found) if (!ids.has(id)) ids.set(id, faker.identifier(id));
  return ids;
}

/** Replaces each id wherever it stands alone, in text runs and attributes (never in Gmail's `data-legacy-*` ids). */
export function replaceIds(doc: Document, ids: ReadonlyMap<string, string>, stats: RowStats): void {
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
      if (value === null || SKIPPED_ATTRIBUTES.has(attribute.name) || attribute.name.startsWith(OBSERVER_IDS))
        continue;
      const replaced = replace(value);
      if (replaced !== value) element.setAttribute(attribute.name, replaced);
    }
  }
}

/**
 * Fakes, in place, the card endings, order numbers, codes, UUIDs and postal addresses of `doc` that the module
 * comment names. The same value always gets the same fake (`faker` is the capture's).
 */
export function fakeRowValues(doc: Document, faker: Faker, stats: RowStats, options: RowOptions = {}): void {
  fakeAddresses(doc, faker, stats);
  const ids = collectIds(doc, faker, options);
  fakeRowCards(doc, faker, stats);
  replaceIds(doc, ids, stats);
}
