/**
 * The reference reader of an opened Gmail message, for the fixture checks (./fixture-pages.spec.ts): written apart
 * from the receipt observer, so a label that drifts from its page fails. Every opened message of a conversation is
 * read (a real Uber thread holds two, 2026-10-07), each as its lines: innermost blocks, and a table row that holds
 * other rows but has exactly two cells with text (a label in a table of its own beside its amount).
 */
import type { Document, Element } from 'happy-dom';

import { amount, isCurrencyCode, type Money } from '../../../src/core/normalize';
import { collapse } from './fixture-page-read';

export interface MessageLine {
  readonly text: string;
  /** Every amount the line shows, as normalize.amount reads it with the page's bare-dollar default. */
  readonly amounts: readonly Money[];
}

export interface OpenedMessage {
  readonly key: string;
  readonly subject: string;
  readonly senderName: string;
  readonly dateTitle: string;
  /** The message's innermost blocks (table rows, paragraphs, list items, divs): a label and its amount share one. */
  readonly lines: readonly MessageLine[];
}

const AMOUNT_TOKEN = /(?:[A-Z]{1,3}\$|[$€£¥]|\b[A-Z]{3}\s)?\s?\d[\d.,]*\d(?:\s?(?:€|[A-Z]{3}\b))?/gu;
const BLOCKS = 'tr, p, li, div, h1, h2, h3';

/** What a bare `$` means is the page fact's `defaultDollar`; none (or an unknown code) leaves a bare `$` unread. */
function amountsIn(text: string, defaultDollar: string | undefined): Money[] {
  const options = defaultDollar !== undefined && isCurrencyCode(defaultDollar) ? { defaultDollar } : {};
  return Array.from(text.matchAll(AMOUNT_TOKEN), ([token]) => amount(token.trim(), options)).filter(
    (money): money is Money => money !== null,
  );
}

/** A message item's `data-legacy-message-id`: on the item, or (real Gmail, 2026-10-06) on an element inside it. */
function messageKey(item: Element): string {
  return (
    item.getAttribute('data-legacy-message-id') ??
    item.querySelector('[data-legacy-message-id]')?.getAttribute('data-legacy-message-id') ??
    ''
  );
}

/**
 * A table row that holds other rows but reads as one line: exactly two of its cells hold text, a label and its value
 * (Stripe wraps the label in a table of its own: `["", <table>Total</table>, "", "$12.34", ""]`, capture of
 * 2026-10-07).
 */
function pairRows(item: Element): string[] {
  return Array.from(item.querySelectorAll('tr'))
    .filter((row) => row.querySelector('tr') !== null)
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => cell.localName === 'td' || cell.localName === 'th')
        .map((cell) => collapse(cell.textContent))
        .filter((text) => text !== ''),
    )
    .filter((cells) => cells.length === 2)
    .map((cells) => cells.join(' '));
}

function readMessage(doc: Document, item: Element, defaultDollar: string | undefined): OpenedMessage {
  const leaves = Array.from(item.querySelectorAll(BLOCKS)).filter(
    (block) => block.querySelector(BLOCKS) === null,
  );
  const texts = [...leaves.map((block) => collapse(block.textContent)), ...pairRows(item)];
  return {
    key: messageKey(item),
    subject: collapse(doc.querySelector('[role="main"] h2[data-legacy-thread-id]')?.textContent),
    senderName: collapse(item.querySelector('[email][name]')?.getAttribute('name')),
    dateTitle: item.querySelector('span[title]')?.getAttribute('title') ?? '',
    lines: texts.map((text) => ({ text, amounts: amountsIn(text, defaultDollar) })),
  };
}

/** Every opened message of the page, in order: a conversation shows several (a real Uber thread, 2026-10-07). */
export function openedMessages(doc: Document, defaultDollar: string | undefined): OpenedMessage[] {
  return Array.from(doc.querySelectorAll('[role="main"] [role="listitem"]'))
    .filter((item) => messageKey(item) !== '')
    .map((item) => readMessage(doc, item, defaultDollar));
}

/** The page's one opened message, or null when it shows none or several. */
export function openedMessage(doc: Document, defaultDollar: string | undefined): OpenedMessage | null {
  const messages = openedMessages(doc, defaultDollar);
  return messages.length === 1 ? (messages[0] ?? null) : null;
}
