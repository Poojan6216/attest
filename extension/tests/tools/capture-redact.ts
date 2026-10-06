/**
 * --redact-selector (./sanitize.ts): the text and labels of matching elements become seeded fake phrases, and each
 * replaced text is remembered as a literal the page scrubber then replaces wherever else it appears (except inside
 * --keep-selector areas). Runs on the inert copy only.
 */
import type { Document, Element, Text } from 'happy-dom';

import { textNodes } from './capture-dom';
import { CaptureError } from './capture-error';
import type { Faker } from './capture-fakes';

const MIN_LITERAL_LENGTH = 4;
const REDACTED_ATTRIBUTES = 'title aria-label aria-description alt data-tooltip placeholder value'.split(' ');

/** The counter this module adds to (./sanitize.ts SanitizeStats). */
export interface RedactStats {
  redactedTexts: number;
}

export interface Redactions {
  readonly literals: Map<string, string>;
  readonly texts: Set<Text>;
  readonly attributes: Map<Element, Set<string>>;
}

export function selectAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    throw new CaptureError(
      'bad_selector',
      `--redact-selector ${JSON.stringify(selector)} is not a valid CSS selector.`,
    );
  }
}

function redactElement(element: Element, faker: Faker, redactions: Redactions, stats: RedactStats): void {
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

export function redactSelected(
  doc: Document,
  selectors: readonly string[],
  faker: Faker,
  stats: RedactStats,
): Redactions {
  const redactions: Redactions = { literals: new Map(), texts: new Set(), attributes: new Map() };
  for (const selector of selectors) {
    for (const element of selectAll(doc, selector)) redactElement(element, faker, redactions, stats);
  }
  return redactions;
}
