/**
 * The part of the capture that runs INSIDE the founder's page, via Playwright's page.evaluate.
 *
 * Strictly read-only on the live page: it reads the DOM and computed styles, and builds the snapshot on a
 * deep copy imported into an inert document (no browsing context: no scripts, no custom-element constructors,
 * no resource loads). It never mutates, clicks, scrolls, focuses or dispatches anything on the live page.
 *
 * Constraints of running in the page: no imports and no closures over module scope (constants arrive as the
 * serialisable `config` argument), and no inner named functions (tsx's keepNames would inject a `__name`
 * helper the page does not have).
 */
import { z } from 'zod';

export const PageSnapshotSchema = z.strictObject({
  html: z.string().min(1),
  url: z.string(),
  elementCount: z.number().int().nonnegative(),
});

export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

export interface SnapshotConfig {
  /** Inherited properties: written only where they differ from the parent element. */
  readonly inherited: readonly string[];
  readonly svgInherited: readonly string[];
  /** Written only when not the default: always, on flex/grid containers, on flex items. */
  readonly always: readonly string[];
  readonly flexContainer: readonly string[];
  readonly gridContainer: readonly string[];
  readonly flexItem: readonly string[];
  readonly defaults: Readonly<Record<string, string>>;
  /** Removed from the copy: they execute or embed, and SVG <style> trips the Node-side parser. */
  readonly dropSelector: string;
}

/** The "critical" computed styles inlined onto each element so a fixture renders recognisably. */
export const SNAPSHOT_CONFIG: SnapshotConfig = {
  inherited: ['visibility', 'font-size', 'font-weight', 'color'],
  svgInherited: ['fill', 'stroke'],
  always: ['position', 'background-color'],
  flexContainer: ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap'],
  gridContainer: ['grid-template-columns', 'grid-template-rows', 'justify-content', 'align-items', 'gap'],
  flexItem: ['flex-grow', 'flex-shrink', 'flex-basis'],
  defaults: {
    position: 'static',
    'background-color': 'rgba(0, 0, 0, 0)',
    'flex-direction': 'row',
    'flex-wrap': 'nowrap',
    'justify-content': 'normal',
    'align-items': 'normal',
    gap: 'normal',
    'grid-template-columns': 'none',
    'grid-template-rows': 'none',
    'flex-grow': '0',
    'flex-shrink': '1',
    'flex-basis': 'auto',
  },
  dropSelector: 'script, noscript, template, iframe, frame, object, embed, svg style',
};

/** Runs in the page. Returns the serialized clone with the critical computed styles inlined. */
export function snapshotDocument(config: SnapshotConfig): PageSnapshot {
  const inert = document.implementation.createHTMLDocument('');
  const root = inert.importNode(document.documentElement, true);
  const live = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  const copy = inert.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const computed = new Map<Element, Record<string, string>>();
  let elementCount = 0;
  for (
    let liveNode: Node | null = live.currentNode, copyNode: Node | null = copy.currentNode;
    liveNode !== null && copyNode !== null;
    liveNode = live.nextNode(), copyNode = copy.nextNode()
  ) {
    if (!(liveNode instanceof Element) || !(copyNode instanceof Element)) continue;
    elementCount += 1;
    if (liveNode.closest('head') !== null) continue;
    // A box's ticked state as the page shows it, not as its markup began: a page script that ticks or unticks a box
    // changes the `checked` property only, and the copy keeps attributes (Google Calendar's calendar list does this).
    if (liveNode instanceof HTMLInputElement && (liveNode.type === 'checkbox' || liveNode.type === 'radio')) {
      if (liveNode.checked) copyNode.setAttribute('checked', '');
      else copyNode.removeAttribute('checked');
    }
    const style = getComputedStyle(liveNode);
    const parentValues = liveNode.parentElement === null ? undefined : computed.get(liveNode.parentElement);
    const display = style.getPropertyValue('display');
    const own: Record<string, string> = { display };
    const declarations = [`display: ${display}`];
    const svg = liveNode.namespaceURI === 'http://www.w3.org/2000/svg';
    for (const property of svg ? config.inherited.concat(config.svgInherited) : config.inherited) {
      const value = style.getPropertyValue(property);
      own[property] = value;
      if (parentValues?.[property] !== value) declarations.push(`${property}: ${value}`);
    }
    const layout = config.always
      .concat(display.includes('flex') ? config.flexContainer : [])
      .concat(display.includes('grid') ? config.gridContainer : [])
      .concat((parentValues?.display ?? '').includes('flex') ? config.flexItem : []);
    for (const property of layout) {
      const value = style.getPropertyValue(property);
      if (value !== '' && value !== 'transparent' && value !== config.defaults[property]) {
        declarations.push(`${property}: ${value}`);
      }
    }
    computed.set(liveNode, own);
    const existing = copyNode.getAttribute('style') ?? '';
    const inline = declarations.join('; ');
    copyNode.setAttribute('style', existing.trim() === '' ? inline : `${existing}; ${inline}`);
  }
  for (const element of Array.from(root.querySelectorAll(config.dropSelector))) element.remove();
  const doctype = document.doctype === null ? '' : `<!DOCTYPE ${document.doctype.name}>`;
  return { html: doctype + root.outerHTML, url: location.href, elementCount };
}
