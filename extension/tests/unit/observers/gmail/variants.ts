/**
 * Variants of the Gmail fixtures for the Sent observer's structural tests: open a fixture (or its markup at another
 * address), change its DOM the way Gmail or a selector break would, and run one pass. Test code only: it writes the
 * test's own copy of the page, never a vendor page.
 */
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { IsoTs } from '../../../../src/core/schema';
import { gmailSentObserver } from '../../../../src/observers/gmail/sent-observer';
import { type PassPlan, planPass } from '../../../../src/observers/plan';
import type { ExtractContext } from '../../../../src/observers/types';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { fixtureCtx, fixtureHtml, fixtureNamed, openPage } from './sent-fixtures';

export const PAGE_1 = 'synthetic-sent-page-1.html';

export interface Variant {
  /** The fixture whose markup is used. */
  readonly file?: string;
  /** The address the page is opened at (default: the fixture's live URL). */
  readonly url?: string;
  /** Changes the test's copy of the page before the pass. */
  readonly mutate?: (doc: Document) => void;
  /** The pass context (default: the fixture's readAt in its time zone). */
  readonly ctx?: ExtractContext;
}

/** One pass over a variant of a fixture. */
export async function planVariant(variant: Variant = {}): Promise<PassPlan> {
  const fixture = fixtureNamed(variant.file ?? PAGE_1);
  const page = openPage(fixtureHtml(fixture), variant.url ?? fixture.page.liveUrl);
  try {
    variant.mutate?.(page.doc);
    return planPass({
      observer: gmailSentObserver,
      doc: page.doc,
      ctx: variant.ctx ?? fixtureCtx(fixture),
      policy: DEFAULT_POLICY,
    });
  } finally {
    await page.close();
  }
}

/** A pass context read at `at` in New York (for DST and clock tests on New York fixtures). */
export function newYorkCtx(at: string): ExtractContext {
  return { observedAt: IsoTs.parse(at), offsetAt: zoneOffset('America/New_York') };
}

/** The element `selector` finds in `doc`; throws when there is none, so a broken variant fails loud. */
export function one(doc: Document | Element, selector: string): Element {
  const found = doc.querySelector(selector);
  if (found === null) throw new Error(`variant: nothing matches ${selector}`);
  return found;
}

/** Every element `selector` finds. */
export const all = (doc: Document | Element, selector: string): Element[] =>
  Array.from(doc.querySelectorAll(selector));

/** The `index`-th list row (0 = newest). */
export function row(doc: Document, index: number): Element {
  const found = all(doc, '[role="main"] [role="grid"] [role="row"]')[index];
  if (found === undefined) throw new Error(`variant: no row ${String(index)}`);
  return found;
}

/** Sets the row's time element: `title` (null removes it), `aria-label` and text. */
export function setRowTime(target: Element, time: { title: string | null; label: string }): void {
  const span = one(target, '[role="gridcell"]:last-child [aria-label]');
  if (time.title === null) span.removeAttribute('title');
  else span.setAttribute('title', time.title);
  span.setAttribute('aria-label', time.label);
  span.textContent = time.label;
}

const isElement = (node: Node): node is Element => node.nodeType === node.ELEMENT_NODE;

/** Wraps a copy of the shown list in a container hidden by `hide`, with other recipients (an earlier view). */
export function addHiddenView(doc: Document, hide: (container: Element) => void): void {
  const grid = one(doc, '[role="main"] [role="grid"]');
  const copy = grid.cloneNode(true);
  if (!isElement(copy)) throw new Error('variant: clone failed');
  for (const el of all(copy, '[email]')) el.setAttribute('email', 'stale.view@example.net');
  const container = doc.createElement('div');
  container.append(copy);
  hide(container);
  one(doc, '[role="main"]').append(container);
}
