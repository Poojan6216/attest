/**
 * happy-dom plumbing and the structural rules of the fixture sanitiser: what is removed outright (it executes
 * or fetches) and how each attribute is treated. No PII logic lives here; see capture-pii.ts.
 */
import { Comment, type Document, Element, NodeFilter, Text, Window } from 'happy-dom';

import { stripQueryParts } from './capture-url';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements removed with their whole subtree: they run code, embed other documents, or fetch on render. */
const REMOVED_ELEMENTS = new Set([
  'script',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'param',
  'base',
  'link',
  'portal',
  'fencedframe',
]);
/** Attributes that make the browser fetch something on render. */
const RESOURCE_ATTRIBUTES = new Set([
  'src',
  'srcset',
  'imagesrcset',
  'poster',
  'background',
  'lowsrc',
  'dynsrc',
  'ping',
  'manifest',
  'codebase',
  'archive',
  'attributionsrc',
]);
/**
 * Navigational URLs: kept, minus query strings, parameter fragments and userinfo (where tokens and ids live).
 * Includes the data-* attributes vendors keep links in (Gmail's data-saferedirecturl carries a signature).
 */
const LINK_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'action',
  'formaction',
  'cite',
  'data-saferedirecturl',
  'data-url',
  'data-href',
  'data-link',
]);
const DANGEROUS_SCHEME =
  /^(?:javascript|vbscript|livescript):|^data:(?:text\/html|application\/xhtml|image\/svg)/;

/** A happy-dom window that cannot run scripts, load resources, navigate, or fetch (every request gets 451). */
export function createInertWindow(): Window {
  return new Window({
    url: 'http://sanitize.invalid/',
    settings: {
      // happy-dom 20 defaults this off; stated here so an upgrade cannot turn on script execution (SECURITY-7).
      enableJavaScriptEvaluation: false,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
        disableFallbackToSetURL: true,
      },
      fetch: {
        interceptor: {
          beforeAsyncRequest: ({ window }) => Promise.resolve(new window.Response(null, { status: 451 })),
          beforeSyncRequest: ({ window, request }) => ({
            status: 451,
            statusText: 'Blocked by the Attest fixture sanitiser',
            ok: false,
            url: request.url,
            redirected: false,
            headers: new window.Headers(),
            body: null,
          }),
        },
      },
    },
  });
}

/** Closes a window in the background; a failure to close is reported, never thrown into the caller. */
export function closeWindow(window: Window): void {
  window.happyDOM.close().catch((error: unknown) => {
    console.warn('capture.sanitize.window_close_failed', error);
  });
}

export function textNodes(root: Element | Document): Text[] {
  const nodes: Text[] = [];
  const doc = root instanceof Element ? root.ownerDocument : root;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text) nodes.push(node);
  }
  return nodes;
}

/** Removes every comment (they can carry anything). Returns how many. */
export function removeComments(doc: Document): number {
  const comments: Comment[] = [];
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Comment) comments.push(node);
  }
  for (const comment of comments) comment.remove();
  return comments.length;
}

/** `<meta name="csrf-token" content="…">` and the like: session secrets, never page content. */
const SECRET_META = /csrf|xsrf|token|nonce|secret/i;

function isRemovedElement(element: Element): boolean {
  const name = element.localName.toLowerCase();
  if (REMOVED_ELEMENTS.has(name)) return true;
  if (name === 'meta') {
    return element.hasAttribute('http-equiv') || SECRET_META.test(element.getAttribute('name') ?? '');
  }
  if (name === 'set' || name === 'animate') {
    const target = element.getAttribute('attributeName') ?? element.getAttribute('attributename') ?? '';
    return /^(?:xlink:)?href$/i.test(target);
  }
  return false;
}

/** Removes every element that executes, embeds or fetches, with its subtree. Returns how many. */
export function removeDangerousElements(doc: Document): number {
  let removed = 0;
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    if (element.isConnected && isRemovedElement(element)) {
      element.remove();
      removed += 1;
    }
  }
  return removed;
}

/**
 * handler/scheme: removed (they run code). resource: removed (it fetches). secret: removed (a session token).
 * link: kept, trimmed by trimUrl. style: CSS-sanitised. presentation: an SVG attribute whose url(…) Chromium
 * fetches like CSS (fill, mask, clip-path, marker-*, cursor); its urls are neutralised. text: PII-scrubbed.
 */
export type AttributeVerdict =
  'handler' | 'scheme' | 'resource' | 'secret' | 'link' | 'style' | 'presentation' | 'text';

const SECRET_INPUT_TYPES = new Set(['hidden', 'password']);

/** CSP nonces, and the value of a hidden or password input (CSRF and session tokens live there). */
function isSecretAttribute(element: Element, lower: string): boolean {
  if (lower === 'nonce') return true;
  if (lower !== 'value' || element.localName !== 'input') return false;
  return SECRET_INPUT_TYPES.has(element.getAttribute('type')?.toLowerCase() ?? '');
}

export function attributeVerdict(element: Element, name: string, value: string): AttributeVerdict {
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || lower.includes('@')) return 'handler';
  if (isSecretAttribute(element, lower)) return 'secret';
  const compact = Array.from(value)
    .filter((ch) => ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .toLowerCase();
  if (DANGEROUS_SCHEME.test(compact)) return 'scheme';
  if (RESOURCE_ATTRIBUTES.has(lower)) return 'resource';
  const svgReference = lower === 'href' || lower === 'xlink:href';
  if (svgReference && element.namespaceURI === SVG_NS && element.localName !== 'a') {
    return value.trim().startsWith('#') ? 'text' : 'resource';
  }
  if (LINK_ATTRIBUTES.has(lower)) return 'link';
  if (lower === 'style') return 'style';
  return element.namespaceURI === SVG_NS ? 'presentation' : 'text';
}

/**
 * Drops `user:password@`, the query string and any fragment that carries parameters (`#access_token=…`, the
 * `?…` of `#inbox?compose=…`); keeps scheme, host, path and a plain #fragment.
 */
export function trimUrl(value: string): string {
  const bare = value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1').replace(/\?[^#]*/, '');
  return stripQueryParts(bare).text;
}
