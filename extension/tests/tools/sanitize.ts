/**
 * sanitizeHtml(html, options): turns a captured vendor page into a fixture that is safe to commit.
 *
 * Pure: same (html, options) → same output, byte for byte. No clock, no randomness (fakes come from the seed),
 * no I/O, and no network — happy-dom runs with scripts off, resource loading off, navigation off, and a fetch
 * interceptor that refuses every request. Steps, in order:
 *  1. strip what executes or fetches: scripts, frames, objects, <base>, <link>, meta http-equiv, comments,
 *     on* handlers, javascript:/vbscript:/data:text/html URLs, and every external resource reference (CSS and
 *     SVG presentation url(), escaped CSS function names included); drop session secrets (nonce, hidden-input
 *     values, csrf meta);
 *  2. learn display names (`Name <email>`, name/title/aria-label beside an email attribute, --names);
 *  3. replace --redact-selector text with fake phrases;
 *  4. scrub every text node and attribute: query strings and parameter fragments anywhere (text, data-*,
 *     meta content, relative URLs), then emails (plain, percent-encoded, inside base64 ids), phones, cards,
 *     money, street addresses, names, redacted literals;
 *  5. inject three seeded secrets into the main landmark for the no-leak test.
 * Roles, aria-*, data-*, ids, classes and structure are kept: adapters anchor on them.
 *
 * Receipt senders stay parseable (`keepSenders`, default: the receipt-parser registry): an address at a registry
 * domain keeps its domain, with a fake local part (the parsers read only the domain; people work at these domains
 * too). A display name at a `nameDomains` domain is kept when it is a business's (capture-pii.ts `isKeptName`: a
 * machine `+tag` sender, the merchant a parser reads, or a name holding a registry brand). Every other address and
 * name is faked.
 */
import type { Document, Element, Text } from 'happy-dom';

import { RECEIPT_SENDER_DOMAINS, RECEIPT_SENDER_NAME_DOMAINS } from '../../src/observers/gmail/receipts';

import { neutraliseCssUrls, sanitizeCss } from './capture-css';
import {
  attributeVerdict,
  closeWindow,
  createInertWindow,
  removeComments,
  removeDangerousElements,
  textNodes,
  trimUrl,
} from './capture-dom';
import { CaptureError } from './capture-error';
import { Faker } from './capture-fakes';
import { stripForeignRawText } from './capture-html-guard';
import { learnNames, localNamesFor, type NameBook } from './capture-names';
import {
  EMAIL_SOURCE,
  EMAIL_VALUE,
  emptyScrubStats,
  findForeignAts,
  isKeptName,
  NAME_BEFORE_EMAIL,
  nameTokens,
  Scrubber,
  type ScrubStats,
} from './capture-pii';
import { stripQueryParts } from './capture-url';

export interface SeedSecret {
  readonly id: string;
  readonly value: string;
  readonly canaries: readonly string[];
}

/** Which receipt senders a capture keeps: addresses at `domains`, and display names at `nameDomains` too. */
export interface KeptSenders {
  readonly domains: readonly string[];
  readonly nameDomains: readonly string[];
}

/** The receipt-parser registry (src/observers/gmail/receipts/selectors.json): the default `keepSenders`. */
export const RECEIPT_SENDERS: KeptSenders = Object.freeze({
  domains: RECEIPT_SENDER_DOMAINS,
  nameDomains: RECEIPT_SENDER_NAME_DOMAINS,
});

export interface SanitizeOptions {
  /** Seed for every fake and for the choice of injected secrets. */
  readonly seed: string;
  /** Candidates for injection (tests/fixtures/secrets/seeded.json). */
  readonly seeds: readonly SeedSecret[];
  /** Real names to replace everywhere, whole and token by token (--names). */
  readonly names?: readonly string[];
  /** CSS selectors whose text and labels become fake phrases (--redact-selector). */
  readonly redactSelectors?: readonly string[];
  /** Receipt senders to keep (default RECEIPT_SENDERS; `{ domains: [], nameDomains: [] }` keeps none). */
  readonly keepSenders?: KeptSenders;
}

export interface SanitizeStats extends ScrubStats {
  removedElements: number;
  removedComments: number;
  removedAttributes: number;
  neutralisedResources: number;
  trimmedUrls: number;
  redactedTexts: number;
}

export interface SanitizeResult {
  readonly html: string;
  /** Ids of the injected seeds, in injection order. */
  readonly seededSecrets: readonly string[];
  readonly stats: Readonly<SanitizeStats>;
}

export const SEEDS_PER_FIXTURE = 3;
const MIN_LITERAL_LENGTH = 4;
const REDACTED_ATTRIBUTES = 'title aria-label aria-description alt data-tooltip placeholder value'.split(' ');

interface Redactions {
  readonly literals: Map<string, string>;
  readonly texts: Set<Text>;
  readonly attributes: Map<Element, Set<string>>;
}

function emptyStats(): SanitizeStats {
  return {
    removedElements: 0,
    removedComments: 0,
    removedAttributes: 0,
    neutralisedResources: 0,
    trimmedUrls: 0,
    redactedTexts: 0,
    ...emptyScrubStats(),
  };
}

function selectAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    throw new CaptureError(
      'bad_selector',
      `--redact-selector ${JSON.stringify(selector)} is not a valid CSS selector.`,
    );
  }
}

/** Throws CaptureError('bad_selector') for the first selector happy-dom cannot parse. */
export function assertSelectorsValid(selectors: readonly string[]): void {
  const window = createInertWindow();
  try {
    for (const selector of selectors) selectAll(window.document, selector);
  } finally {
    closeWindow(window);
  }
}

function redactElement(element: Element, faker: Faker, redactions: Redactions, stats: SanitizeStats): void {
  for (const node of textNodes(element)) {
    const original = node.data.trim();
    if (original === '' || redactions.texts.has(node)) continue;
    const fake = faker.phrase(original);
    node.data = node.data.replace(original, () => fake);
    redactions.texts.add(node);
    if (original.length >= MIN_LITERAL_LENGTH) redactions.literals.set(original, fake);
    stats.redactedTexts += 1;
  }
  for (const target of [element, ...Array.from(element.querySelectorAll('*'))]) {
    const done = redactions.attributes.get(target) ?? new Set<string>();
    for (const name of REDACTED_ATTRIBUTES) {
      const original = target.getAttribute(name)?.trim() ?? '';
      if (original === '' || done.has(name)) continue;
      const fake = faker.phrase(original);
      target.setAttribute(name, fake);
      done.add(name);
      if (original.length >= MIN_LITERAL_LENGTH) redactions.literals.set(original, fake);
    }
    redactions.attributes.set(target, done);
  }
}

function redactSelected(
  doc: Document,
  selectors: readonly string[],
  faker: Faker,
  stats: SanitizeStats,
): Redactions {
  const redactions: Redactions = { literals: new Map(), texts: new Set(), attributes: new Map() };
  for (const selector of selectors) {
    for (const element of selectAll(doc, selector)) redactElement(element, faker, redactions, stats);
  }
  return redactions;
}

function scrubAttributes(
  element: Element,
  scrubber: Scrubber,
  book: NameBook,
  redactions: Redactions,
  stats: SanitizeStats,
): void {
  const local = book.local.get(element);
  const redacted = redactions.attributes.get(element);
  for (const attribute of Array.from(element.attributes)) {
    const original = attribute.value ?? '';
    const verdict = attributeVerdict(element, attribute.name, original);
    if (verdict === 'handler' || verdict === 'scheme' || verdict === 'resource' || verdict === 'secret') {
      element.removeAttributeNode(attribute);
      if (verdict === 'resource') stats.neutralisedResources += 1;
      else stats.removedAttributes += 1;
      continue;
    }
    let value = original;
    if (verdict === 'style') {
      const css = sanitizeCss(value);
      stats.neutralisedResources += css.urlsNeutralised + css.atRulesRemoved;
      value = scrubber.scrubCss(css.css);
    } else {
      if (verdict === 'presentation') {
        const css = neutraliseCssUrls(value);
        stats.neutralisedResources += css.count;
        value = css.css;
      }
      if (verdict === 'link') {
        const trimmed = trimUrl(value);
        if (trimmed !== value) stats.trimmedUrls += 1;
        value = trimmed;
      }
      if (redacted?.has(attribute.name) !== true) value = scrubber.scrub(value, local);
    }
    if (value !== original) element.setAttribute(attribute.name, value);
  }
}

function scrubDocument(
  doc: Document,
  scrubber: Scrubber,
  book: NameBook,
  redactions: Redactions,
  stats: SanitizeStats,
): void {
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    if (element.localName === 'style') {
      const css = sanitizeCss(element.textContent);
      stats.neutralisedResources += css.urlsNeutralised + css.atRulesRemoved;
      element.textContent = scrubber.scrubCss(css.css);
    }
    scrubAttributes(element, scrubber, book, redactions, stats);
  }
  for (const node of textNodes(doc)) {
    const parent = node.parentElement;
    if (redactions.texts.has(node) || parent?.localName === 'style') continue;
    const scrubbed = scrubber.scrub(node.data, localNamesFor(parent, book));
    if (scrubbed !== node.data) node.data = scrubbed;
  }
}

/**
 * A seed a fixture may carry: not blank, no '@', and no URL query or parameter fragment (`url_with_token`): the
 * scrubber strips those from pages, and a committed fixture holds no token query (SECURITY-2).
 */
function injectable(candidate: SeedSecret): boolean {
  const value = candidate.value;
  return value.trim() !== '' && !value.includes('@') && stripQueryParts(value).removed === 0;
}

/** Three seeds chosen by the seed alone, so a re-capture with the same seed injects the same three. */
export function pickSeeds(seeds: readonly SeedSecret[], seed: string): SeedSecret[] {
  const faker = new Faker(seed);
  const byId = new Map<string, SeedSecret>();
  for (const candidate of seeds) {
    if (injectable(candidate)) byId.set(candidate.id, candidate);
  }
  if (byId.size < SEEDS_PER_FIXTURE) {
    throw new CaptureError(
      'too_few_seeds',
      `Need at least ${SEEDS_PER_FIXTURE} seeds without '@' or a URL query; got ${byId.size}.`,
    );
  }
  return [...byId.values()]
    .map((candidate) => ({ candidate, rank: faker.bytes('seed-pick', candidate.id).toString('hex') }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .slice(0, SEEDS_PER_FIXTURE)
    .map(({ candidate }) => candidate);
}

/** The attributes capture-names.ts learns a display name from, beside an email attribute. */
const NAME_ATTRIBUTES = ['name', 'title', 'aria-label', 'data-name'];
const EMAIL_ANYWHERE = new RegExp(EMAIL_SOURCE, 'gu');

/** A display name as capture-names.ts files it: addresses and brackets out, white space collapsed. */
function bookName(raw: string): string {
  return raw
    .replace(EMAIL_ANYWHERE, ' ')
    .replace(/[<>()[\]"\s]+/g, ' ')
    .trim();
}

/** Display names of kept-name senders (capture-pii.ts `isKeptName`): `Name <address>` in text and attributes. */
function keptSenderNames(doc: Document, book: NameBook, nameDomains: readonly string[]): Set<string> {
  const names = new Set<string>();
  const fromText = (text: string): void => {
    if (!text.includes('@')) return;
    NAME_BEFORE_EMAIL.lastIndex = 0;
    for (let match = NAME_BEFORE_EMAIL.exec(text); match !== null; match = NAME_BEFORE_EMAIL.exec(text)) {
      const name = match[1] ?? match[2] ?? match[3];
      if (name !== undefined && isKeptName(name, match[4] ?? match[5] ?? '', nameDomains))
        names.add(bookName(name));
    }
  };
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    const attributes = Array.from(element.attributes);
    const addresses = attributes
      .filter((a) => !NAME_ATTRIBUTES.includes(a.name) && EMAIL_VALUE.test(a.value ?? ''))
      .map((a) => (a.value ?? '').trim().replace(/^mailto:/i, ''));
    const shown = NAME_ATTRIBUTES.map((a) => bookName(element.getAttribute(a) ?? '')).filter((n) => n !== '');
    const kept = shown.filter((name) => addresses.some((address) => isKeptName(name, address, nameDomains)));
    // The element's own name tokens stay replaceable inside it unless every name it shows is kept.
    if (kept.length > 0 && kept.length === shown.length) book.local.delete(element);
    for (const name of kept) names.add(name);
    for (const attribute of attributes) fromText(attribute.value ?? '');
  }
  for (const node of textNodes(doc)) fromText(node.data);
  names.delete('');
  return names;
}

/**
 * Unlearns the display names of kept-name receipt senders (a business, the merchant a parser reads), so they
 * survive. A token another learned name still uses, or a --names token, stays replaceable everywhere.
 */
function keepSenderNames(doc: Document, book: NameBook, kept: KeptSenders, founder: readonly string[]): void {
  if (kept.nameDomains.length === 0) return;
  const names = keptSenderNames(doc, book, kept.nameDomains);
  const founderNames = new Set(founder.map((name) => name.trim()));
  for (const name of names) if (!founderNames.has(name)) book.global.delete(name);
  const lower = (token: string): string => token.toLowerCase();
  const needed = new Set(founder.flatMap((name) => nameTokens(name, true)).map(lower));
  for (const name of book.global) for (const token of nameTokens(name)) needed.add(lower(token));
  for (const local of book.local.values()) for (const token of local) needed.add(lower(token));
  for (const name of names) {
    for (const token of nameTokens(name).map(lower)) if (!needed.has(token)) book.tokens.delete(token);
  }
}

function injectSeeds(doc: Document, chosen: readonly SeedSecret[]): void {
  const landmark = doc.querySelector('[role~="main"]') ?? doc.querySelector('main') ?? doc.body;
  for (const secret of chosen) {
    const element = doc.createElement('div');
    element.setAttribute('data-attest-seeded', secret.id);
    element.setAttribute('style', 'display: block; visibility: visible');
    element.textContent = secret.value;
    landmark.appendChild(element);
  }
}

function ensureCharset(doc: Document): void {
  for (const meta of Array.from(doc.querySelectorAll('meta[charset]'))) meta.remove();
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.prepend(meta);
}

export function sanitizeHtml(html: string, options: SanitizeOptions): SanitizeResult {
  const chosen = pickSeeds(options.seeds, options.seed);
  const faker = new Faker(options.seed);
  const stats = emptyStats();
  const window = createInertWindow();
  try {
    const guarded = stripForeignRawText(html);
    stats.removedElements += guarded.removed;
    const doc = new window.DOMParser().parseFromString(guarded.html, 'text/html');
    stats.removedComments += removeComments(doc);
    stats.removedElements += removeDangerousElements(doc);
    const kept = options.keepSenders ?? RECEIPT_SENDERS;
    const book = learnNames(doc, options.names ?? []);
    keepSenderNames(doc, book, kept, options.names ?? []);
    faker.reserve(book.tokens);
    const redactions = redactSelected(doc, options.redactSelectors ?? [], faker, stats);
    const scrubber = new Scrubber(faker, {
      globalNames: book.global,
      nameTokens: book.tokens,
      literals: redactions.literals,
      keptDomains: kept.domains,
      keptNameDomains: kept.nameDomains,
    });
    scrubDocument(doc, scrubber, book, redactions, stats);
    ensureCharset(doc);
    injectSeeds(doc, chosen);
    const output = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`;
    const foreign = findForeignAts(output, kept.domains);
    if (foreign.length > 0) {
      throw new CaptureError(
        'foreign_at',
        `${foreign.length} '@' outside the fake domains survived sanitising.`,
      );
    }
    return {
      html: output,
      seededSecrets: chosen.map((secret) => secret.id),
      stats: { ...stats, ...scrubber.stats },
    };
  } finally {
    closeWindow(window);
  }
}
