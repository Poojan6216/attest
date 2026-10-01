/**
 * Works around a happy-dom 20 parser bug before the sanitiser parses captured HTML.
 *
 * happy-dom treats `<style>` and `<script>` inside `<svg>`/`<math>` as raw-text elements, then never matches
 * their (case-preserved) end tag, so it silently swallows the REST OF THE DOCUMENT. That would make a fixture
 * quietly lose content. The capture step already drops these elements in the browser; this guard does the same
 * for any HTML handed to `sanitizeHtml`, with a tag-level scan that skips comments and HTML raw-text content.
 */

const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const FOREIGN_ROOTS = new Set(['svg', 'math']);
const FOREIGN_RAW_TEXT = new Set(['style', 'script']);
const HTML_RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
]);

/** Index just past `</name>` searching from `from`, or the end of the input when it is never closed. */
function closingTagEnd(html: string, name: string, from: number): number {
  const close = new RegExp(String.raw`</${name}\s*>`, 'gi');
  close.lastIndex = from;
  const match = close.exec(html);
  return match === null ? html.length : match.index + match[0].length;
}

export interface GuardResult {
  readonly html: string;
  /** How many `<style>`/`<script>` elements inside svg/math were removed. */
  readonly removed: number;
}

export function stripForeignRawText(html: string): GuardResult {
  const kept: string[] = [];
  let last = 0;
  let foreignDepth = 0;
  let removed = 0;
  const tags = new RegExp(TAG.source, TAG.flags);
  for (let match = tags.exec(html); match !== null; match = tags.exec(html)) {
    const [whole, slash, rawName] = match;
    if (rawName === undefined) continue; // a comment
    const name = rawName.toLowerCase();
    const selfClosing = whole.endsWith('/>');
    if (FOREIGN_ROOTS.has(name)) {
      if (slash === '/') foreignDepth = Math.max(0, foreignDepth - 1);
      else if (!selfClosing) foreignDepth += 1;
    } else if (slash !== '/' && foreignDepth > 0 && FOREIGN_RAW_TEXT.has(name)) {
      const end = selfClosing ? tags.lastIndex : closingTagEnd(html, name, tags.lastIndex);
      kept.push(html.slice(last, match.index));
      last = end;
      tags.lastIndex = end;
      removed += 1;
    } else if (slash !== '/' && foreignDepth === 0 && HTML_RAW_TEXT.has(name) && !selfClosing) {
      // Raw-text content is not markup: skip it so `<svg` inside a script string is not read as a tag.
      tags.lastIndex = closingTagEnd(html, name, tags.lastIndex);
    }
  }
  kept.push(html.slice(last));
  return { html: kept.join(''), removed };
}
