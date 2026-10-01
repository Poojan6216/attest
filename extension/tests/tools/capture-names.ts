/**
 * Learns which names on a captured page belong to people, before anything is scrubbed.
 *
 *  - --names (founder-supplied): the whole name and every token, matched everywhere, in any case.
 *  - `Name <email>` / `"Last, First" <email>` in text or attributes: names of 2+ tokens are matched everywhere.
 *  - name/title/aria-label/data-name on an element that also carries an email attribute (Gmail's
 *    `<span email=… name=…>`): matched everywhere when 2+ tokens, and token by token inside that element, so a
 *    bare first name ("Lena") in the sender cell is replaced too.
 * A one-word sender ("Google") is only replaced locally, so vendor names in the interface survive.
 */
import { type Document, type Element } from 'happy-dom';

import { textNodes } from './capture-dom';
import {
  EMAIL_SOURCE,
  EMAIL_VALUE,
  LOOSE_NAME_SHAPE,
  NAME_BEFORE_EMAIL,
  NAME_SHAPE,
  nameTokens,
} from './capture-pii';

const NAME_ATTRIBUTES = ['name', 'title', 'aria-label', 'data-name'];
const EMAIL_ANYWHERE = new RegExp(EMAIL_SOURCE, 'gu');
/** How far up from a text node to look for the email-carrying element whose name tokens apply. */
const LOCAL_NAME_DEPTH = 4;

export interface NameBook {
  /** Names matched everywhere (word-bounded, any case). */
  readonly global: Set<string>;
  /** Every lowercased token a name fake may replace. */
  readonly tokens: Set<string>;
  /** Tokens matched only inside a given email-carrying element. */
  readonly local: Map<Element, Set<string>>;
}

function learnDisplayName(name: string, book: NameBook): string[] {
  const tokens = nameTokens(name);
  for (const token of tokens) book.tokens.add(token.toLowerCase());
  if (tokens.length >= 2) book.global.add(name.trim().replace(/\s+/g, ' '));
  return tokens;
}

function learnFromText(text: string, book: NameBook): void {
  if (!text.includes('@')) return;
  NAME_BEFORE_EMAIL.lastIndex = 0;
  for (let match = NAME_BEFORE_EMAIL.exec(text); match !== null; match = NAME_BEFORE_EMAIL.exec(text)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name !== undefined) learnDisplayName(name, book);
  }
}

function learnFromElement(element: Element, book: NameBook): void {
  const attributes = Array.from(element.attributes);
  const carriesEmail = attributes.some(
    (attribute) => !NAME_ATTRIBUTES.includes(attribute.name) && EMAIL_VALUE.test(attribute.value ?? ''),
  );
  if (!carriesEmail) return;
  const local = new Set<string>();
  for (const attributeName of NAME_ATTRIBUTES) {
    const raw = element.getAttribute(attributeName);
    if (raw === null) continue;
    const value = raw
      .replace(EMAIL_ANYWHERE, ' ')
      .replace(/[<>()[\]"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const shaped = attributeName === 'name' ? LOOSE_NAME_SHAPE.test(value) : NAME_SHAPE.test(value);
    if (!shaped) continue;
    for (const token of learnDisplayName(value, book)) local.add(token);
  }
  if (local.size > 0) book.local.set(element, local);
}

export function learnNames(doc: Document, founderNames: readonly string[]): NameBook {
  const book: NameBook = { global: new Set(), tokens: new Set(), local: new Map() };
  for (const name of founderNames) {
    const tokens = nameTokens(name, true);
    if (tokens.length === 0) continue;
    book.global.add(name.trim());
    for (const token of tokens) {
      book.global.add(token);
      book.tokens.add(token.toLowerCase());
    }
  }
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    learnFromElement(element, book);
    for (const attribute of Array.from(element.attributes)) learnFromText(attribute.value ?? '', book);
  }
  for (const node of textNodes(doc)) learnFromText(node.data, book);
  return book;
}

/** The local name tokens that apply at `element`: its own, or those of a close email-carrying ancestor. */
export function localNamesFor(element: Element | null, book: NameBook): Set<string> | undefined {
  let current = element;
  for (let depth = 0; current !== null && depth < LOCAL_NAME_DEPTH; depth += 1) {
    const names = book.local.get(current);
    if (names !== undefined) return names;
    current = current.parentElement;
  }
  return undefined;
}
