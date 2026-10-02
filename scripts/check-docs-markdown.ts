/**
 * Markdown scanning for scripts/check-docs.ts: fenced code, inline code spans, link targets, and the anchors
 * GitHub generates for headings.
 *
 * A small, deliberate subset of CommonMark, enough for the repo's own docs:
 * - fences are ``` or ~~~ runs at any indentation (so fences nested in list items count);
 * - code spans are matched within one line (a run of n backticks closes at the next run of exactly n);
 * - links are inline `[text](target)` and `![alt](target)`, reference definitions `[id]: target`, and
 *   `href`/`src` attributes of HTML tags; text inside code is never a link;
 * - headings are ATX (`## Title`) and setext (`Title` over `===` or `---`); explicit `id`/`name` attributes
 *   on HTML tags are anchors too.
 * Indented (four-space) code blocks are not recognised; the docs use fences.
 */

/** One line of a document, 1-based. */
export interface DocLine {
  readonly n: number;
  readonly text: string;
}

/** A link target as written, with the line it is on. */
export interface LinkRef {
  readonly line: number;
  readonly target: string;
}

/** A piece of code: an inline code span, or one line of a fenced block. */
export interface CodeText {
  readonly line: number;
  readonly text: string;
  readonly fenced: boolean;
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

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const NOT_PARAGRAPH = /^\s*(?:[-*+][ \t]|\d+[.)][ \t]|>|#|\||<)/;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:[ \t]*(<[^>]*>|\S+)/;
const HTML_LINK = /<[a-zA-Z][^>]*?\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const HTML_ANCHOR = /<[a-zA-Z][^>]*?\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** github-slugger keeps letters, marks, decimal and letter numbers, connector punctuation, space and '-'. */
const SLUG_DROP = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc} -]/gu;

/** Splits a document into prose lines and fenced code lines (fence delimiters belong to neither). */
export function splitFences(source: string): { prose: DocLine[]; fenced: DocLine[] } {
  const prose: DocLine[] = [];
  const fenced: DocLine[] = [];
  let open: string | null = null;
  source.split(/\r?\n/).forEach((text, index) => {
    const line = { n: index + 1, text };
    if (open === null) {
      const fence = FENCE_OPEN.exec(text)?.[1];
      if (fence === undefined) prose.push(line);
      else open = fence;
      return;
    }
    const close = FENCE_CLOSE.exec(text)?.[1];
    const fenceChar = open.charAt(0);
    if (close?.startsWith(fenceChar) === true && close.length >= open.length) open = null;
    else fenced.push(line);
  });
  return { prose, fenced };
}

/** The index of the next run of exactly `size` backticks at or after `from`, or -1. */
function closingRun(text: string, from: number, size: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] !== '`') {
      i += 1;
      continue;
    }
    let end = i;
    while (text[end] === '`') end += 1;
    if (end - i === size) return i;
    i = end;
  }
  return -1;
}

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

/** The destination of an inline link whose `](` ends just before `start`, or null when malformed. */
function inlineDestination(text: string, start: number): string | null {
  let i = start;
  while (text[i] === ' ' || text[i] === '\t') i += 1;
  if (text[i] === '<') {
    const end = text.indexOf('>', i + 1);
    return end === -1 ? null : text.slice(i + 1, end);
  }
  let depth = 0;
  let end = i;
  for (; end < text.length; end += 1) {
    const ch = text[end];
    if (ch === ' ' || ch === '\t') break;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return end < text.length ? text.slice(i, end) : null;
}

/**
 * Link targets in one line of text that holds no code. `bracketOpen` says a `[` on an earlier line of the same
 * paragraph is still open, so a link whose text wraps onto this line is found here.
 */
export function linkTargets(plain: string, bracketOpen = false): string[] {
  const targets: string[] = [];
  let at = plain.indexOf('](');
  while (at !== -1) {
    const escaped = plain[at - 1] === '\\';
    const opened = bracketOpen || plain.lastIndexOf('[', at) !== -1;
    const target = escaped || !opened ? null : inlineDestination(plain, at + 2);
    if (target !== null) targets.push(target);
    at = plain.indexOf('](', at + 2);
  }
  const definition = REFERENCE_DEFINITION.exec(plain)?.[1];
  if (definition !== undefined) targets.push(definition.replace(/^<|>$/g, ''));
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
  const lastOpen = plain.lastIndexOf('[');
  const lastClose = plain.lastIndexOf(']');
  if (lastOpen === -1 && lastClose === -1) return openBefore;
  return lastOpen > lastClose;
}

/** Links, code and anchors of one Markdown document. */
export function scanMarkdown(source: string): MarkdownScan {
  const { prose, fenced } = splitFences(source);
  const links: LinkRef[] = [];
  const code: CodeText[] = fenced.map((line) => ({ line: line.n, text: line.text, fenced: true }));
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
    for (const part of parts) if (part.code) code.push({ line: line.n, text: part.text, fenced: false });
    open = bracketOpenAfter(plain, continues);
  });
  code.sort((a, b) => a.line - b.line);
  return { links, code, anchors: anchorsOf(prose) };
}
