/**
 * Markdown scanning for scripts/check-docs.ts: code (spans and blocks), link targets, and the anchors GitHub
 * generates for headings.
 *
 * A small, deliberate subset of CommonMark, enough for the repo's own docs:
 * - blocks (fenced and indented code, HTML comments, list items) are split by check-docs-blocks.ts;
 * - code spans are matched within one line (a run of n backticks closes at the next run of exactly n);
 * - links are inline `[text](target)` and `![alt](target)`, reference definitions `[id]: target`, and
 *   `href`/`src` attributes of HTML tags; text inside code is never a link, and a backslash-escaped bracket
 *   (`\[x](y)`) is no link either;
 * - headings are ATX (`## Title`) and setext (`Title` over `===` or `---`); explicit `id`/`name` attributes
 *   on HTML tags are anchors too.
 */
import { closingRun, splitBlocks, type DocLine } from './check-docs-blocks';

export type { DocLine } from './check-docs-blocks';

/** A link target as written, with the line it is on. */
export interface LinkRef {
  readonly line: number;
  readonly target: string;
}

/** A piece of code: an inline code span, or one line of a fenced or indented code block. */
export interface CodeText {
  readonly line: number;
  readonly text: string;
  readonly kind: 'span' | 'fenced' | 'indented';
  /** Lines of one code block share this number; every code span has its own. */
  readonly block: number;
}

export interface MarkdownScan {
  readonly links: readonly LinkRef[];
  readonly code: readonly CodeText[];
  /** Every anchor a `#fragment` may name: heading slugs (with GitHub's -1, -2 suffixes) and HTML ids. */
  readonly anchors: ReadonlySet<string>;
}

interface Segment {
  readonly code: boolean;
  readonly text: string;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const NOT_PARAGRAPH = /^\s*(?:[-*+][ \t]|\d+[.)][ \t]|>|#|\||<)/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:[ \t]*(<[^>]*>|\S+)/;
const HTML_LINK = /<[a-zA-Z][^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const HTML_ANCHOR = /<[a-zA-Z][^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** github-slugger keeps letters, marks, decimal and letter numbers, connector punctuation, space and '-'. */
const SLUG_DROP = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc} -]/gu;

/** CommonMark: strip one space from each end when both ends have one and the span is not all spaces. */
function spanContent(raw: string): string {
  if (raw.length >= 2 && raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '') {
    return raw.slice(1, -1);
  }
  return raw;
}

/** Splits one line into text and inline code spans. Backslash escapes outside code are kept as written. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '\\' && i + 1 < text.length) {
      plain += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== '`') {
      plain += ch;
      i += 1;
      continue;
    }
    let runEnd = i;
    while (text[runEnd] === '`') runEnd += 1;
    const close = closingRun(text, runEnd, runEnd - i);
    if (close === -1) {
      plain += text.slice(i, runEnd);
      i = runEnd;
      continue;
    }
    out.push({ code: false, text: plain }, { code: true, text: spanContent(text.slice(runEnd, close)) });
    plain = '';
    i = close + (runEnd - i);
  }
  out.push({ code: false, text: plain });
  return out.filter((segment) => segment.code || segment.text !== '');
}

/** Whether the character at `i` is backslash-escaped: an odd number of backslashes stands before it. */
function escapedAt(text: string, i: number): boolean {
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/** The index of the last `ch` before index `before` that is not backslash-escaped, or -1. */
function lastUnescaped(text: string, ch: string, before: number = text.length): number {
  for (let i = before - 1; i >= 0; i -= 1) if (text[i] === ch && !escapedAt(text, i)) return i;
  return -1;
}

/** CommonMark backslash escapes (a backslash before ASCII punctuation) resolved, as in a link destination. */
function unescape(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/** The destination of an inline link whose `](` ends just before `start`, or null when malformed. */
function inlineDestination(text: string, start: number): string | null {
  let i = start;
  while (text[i] === ' ' || text[i] === '\t') i += 1;
  if (text[i] === '<') {
    const end = text.indexOf('>', i + 1);
    return end === -1 ? null : unescape(text.slice(i + 1, end));
  }
  let depth = 0;
  let end = i;
  for (; end < text.length; end += 1) {
    const ch = text[end];
    if (ch === '\\') {
      end += 1; // an escaped character never ends the destination
      continue;
    }
    if (ch === ' ' || ch === '\t') break;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return end < text.length ? unescape(text.slice(i, end)) : null;
}

/**
 * Link targets in one line of text that holds no code. `bracketOpen` says a `[` on an earlier line of the same
 * paragraph is still open, so a link whose text wraps onto this line is found here. A backslash-escaped `[` or
 * `]` opens or closes nothing (`\\[x](y)` is text).
 */
export function linkTargets(plain: string, bracketOpen = false): string[] {
  const targets: string[] = [];
  let at = plain.indexOf('](');
  while (at !== -1) {
    const opened = bracketOpen || lastUnescaped(plain, '[', at) !== -1;
    const target = escapedAt(plain, at) || !opened ? null : inlineDestination(plain, at + 2);
    if (target !== null) targets.push(target);
    at = plain.indexOf('](', at + 2);
  }
  const definition = REFERENCE_DEFINITION.exec(plain)?.[1];
  if (definition !== undefined) targets.push(unescape(definition.replace(/^<|>$/g, '')));
  for (const match of plain.matchAll(HTML_LINK)) targets.push(match[1] ?? match[2] ?? '');
  return targets;
}

/** GitHub's anchor for a heading's text (github-slugger, before duplicate suffixes). */
export function githubSlug(text: string): string {
  return text.toLowerCase().replace(SLUG_DROP, '').replace(/ /g, '-');
}

/** A heading's rendered text: code spans verbatim; links, images, HTML tags and emphasis reduced to text. */
export function headingText(raw: string): string {
  return segments(raw)
    .map((segment) => {
      if (segment.code) return segment.text;
      return segment.text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/\\(.)/g, '$1')
        .replace(/\*+/g, '')
        .replace(/(^|[^\p{L}\p{N}_])_+([^_]+?)_+(?=$|[^\p{L}\p{N}_])/gu, '$1$2');
    })
    .join('')
    .trim();
}

/** The heading texts of a document's prose lines, in order (ATX and setext). */
function headings(prose: readonly DocLine[]): string[] {
  const found: string[] = [];
  prose.forEach((line, index) => {
    const atx = ATX.exec(line.text);
    if (atx !== null) {
      found.push(headingText(atx[2] ?? ''));
      return;
    }
    const previous = prose[index - 1];
    const isSetext =
      SETEXT_UNDERLINE.test(line.text) &&
      previous?.n === line.n - 1 &&
      previous.text.trim() !== '' &&
      !NOT_PARAGRAPH.test(previous.text) &&
      !SETEXT_UNDERLINE.test(previous.text);
    if (isSetext) found.push(headingText(previous.text));
  });
  return found;
}

/** Heading slugs with GitHub's duplicate suffixes (`x`, `x-1`, `x-2`, …), plus explicit HTML anchors. */
function anchorsOf(prose: readonly DocLine[]): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const text of headings(prose)) {
    const base = githubSlug(text);
    let slug = base;
    while (anchors.has(slug)) {
      const next = (counts.get(base) ?? 0) + 1;
      counts.set(base, next);
      slug = `${base}-${String(next)}`;
    }
    anchors.add(slug);
  }
  for (const line of prose) {
    const plain = segments(line.text)
      .filter((segment) => !segment.code)
      .map((segment) => segment.text)
      .join(' ');
    for (const match of plain.matchAll(HTML_ANCHOR)) anchors.add(match[1] ?? match[2] ?? '');
  }
  return anchors;
}

/** Whether a `[` is still open at the end of a line: its last `[` comes after its last `]`, or it has neither. */
function bracketOpenAfter(plain: string, openBefore: boolean): boolean {
  const lastOpen = lastUnescaped(plain, '[');
  const lastClose = lastUnescaped(plain, ']');
  if (lastOpen === -1 && lastClose === -1) return openBefore;
  return lastOpen > lastClose;
}

/** Links, code and anchors of one Markdown document. */
export function scanMarkdown(source: string): MarkdownScan {
  const { prose, code: blockLines } = splitBlocks(source);
  const links: LinkRef[] = [];
  const code: CodeText[] = blockLines.map((line) => ({
    line: line.n,
    text: line.text,
    kind: line.kind,
    block: line.block,
  }));
  let spanBlock = Math.max(0, ...blockLines.map((line) => line.block));
  let open = false;
  prose.forEach((line, index) => {
    const parts = segments(line.text);
    const plain = parts
      .filter((part) => !part.code)
      .map((part) => part.text)
      .join(' ');
    // A blank line, a fence or the start of a new block (list item, heading, quote, table row, HTML) ends the
    // paragraph, and with it a `[` left open on an earlier line.
    const continues =
      open && prose[index - 1]?.n === line.n - 1 && line.text.trim() !== '' && !NOT_PARAGRAPH.test(line.text);
    for (const target of linkTargets(plain, continues)) links.push({ line: line.n, target });
    for (const part of parts) {
      if (part.code) code.push({ line: line.n, text: part.text, kind: 'span', block: (spanBlock += 1) });
    }
    open = bracketOpenAfter(plain, continues);
  });
  code.sort((a, b) => a.line - b.line);
  return { links, code, anchors: anchorsOf(prose) };
}
