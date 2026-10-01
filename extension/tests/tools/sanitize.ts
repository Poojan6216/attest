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
 *  4. scrub every text node and attribute: emails (plain, percent-encoded, inside base64 ids), phones, cards,
 *     money, street addresses, names, redacted literals;
 *  5. inject three seeded secrets into the main landmark for the no-leak test.
 * Roles, aria-*, data-*, ids, classes and structure are kept: adapters anchor on them.
 */
import type { Document, Element, Text } from 'happy-dom';

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
import { findForeignAts, Scrubber, type ScrubStats } from './capture-pii';

export interface SeedSecret {
  readonly id: string;
  readonly value: string;
  readonly canaries: readonly string[];
}

export interface SanitizeOptions {
  /** Seed for every fake and for the choice of injected secrets. */
  readonly seed: string;
  /** Candidates for injection (tests/fixtures/secrets/seeded.json). */
  readonly seeds: readonly SeedSecret[];
  /** Real names to replace everywhere, whole and token by token (--names). */
  readonly names?: readonly string[];
  /** CSS selectors whose text and labels become fake phrases (--redact-selector). */
  readonly redactSelectors?: readonly string[];
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
const REDACTED_ATTRIBUTES = [
  'title',
  'aria-label',
  'aria-description',
  'alt',
  'data-tooltip',
  'placeholder',
  'value',
];

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
    literal: 0,
    email: 0,
    address: 0,
    amount: 0,
    phone: 0,
    card: 0,
    name: 0,
    strayAt: 0,
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

/** Three seeds chosen by the seed alone, so a re-capture with the same seed injects the same three. */
export function pickSeeds(seeds: readonly SeedSecret[], seed: string): SeedSecret[] {
  const faker = new Faker(seed);
  const byId = new Map<string, SeedSecret>();
  for (const candidate of seeds) {
    if (candidate.value.trim() !== '' && !candidate.value.includes('@')) byId.set(candidate.id, candidate);
  }
  if (byId.size < SEEDS_PER_FIXTURE) {
    throw new CaptureError(
      'too_few_seeds',
      `Need at least ${SEEDS_PER_FIXTURE} seeds without '@'; got ${byId.size}.`,
    );
  }
  return [...byId.values()]
    .map((candidate) => ({ candidate, rank: faker.bytes('seed-pick', candidate.id).toString('hex') }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .slice(0, SEEDS_PER_FIXTURE)
    .map(({ candidate }) => candidate);
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
    const book = learnNames(doc, options.names ?? []);
    faker.reserve(book.tokens);
    const redactions = redactSelected(doc, options.redactSelectors ?? [], faker, stats);
    const scrubber = new Scrubber(faker, {
      globalNames: book.global,
      nameTokens: book.tokens,
      literals: redactions.literals,
    });
    scrubDocument(doc, scrubber, book, redactions, stats);
    ensureCharset(doc);
    injectSeeds(doc, chosen);
    const output = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`;
    const foreign = findForeignAts(output);
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
