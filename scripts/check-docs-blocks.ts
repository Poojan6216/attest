/**
 * Block structure for scripts/check-docs.ts: which lines of a Markdown document are prose and which are code, as
 * GitHub renders them (a deliberate subset of CommonMark, enough for the repo's own docs; QA-G11):
 * - fenced code: ``` or ~~~ runs at any indentation (so fences nested in list items count);
 * - indented code: lines indented four columns past their container (the document, or the list item they sit in)
 *   that do not continue a paragraph; inside a list item `- x`, four spaces only continue the item (its content
 *   starts at column 2), and code needs four more;
 * - HTML comments (`<!-- … -->`, on one line or many) are neither prose nor code: GitHub shows nothing of them, so
 *   a link or a command inside one is not checked, and a heading inside one is no anchor. Inside a code span or a
 *   code block, `<!--` is just text.
 */

/** One line of a document, 1-based. */
export interface DocLine {
  readonly n: number;
  readonly text: string;
}

/** One line of a code block. Lines of the same block share `block`, so a `cd` carries to the next line. */
export interface CodeLine extends DocLine {
  readonly block: number;
  readonly kind: 'fenced' | 'indented';
}

export interface Blocks {
  /** Prose lines, HTML comments removed (a line that was all comment is kept, blank, as a block break). */
  readonly prose: DocLine[];
  readonly code: CodeLine[];
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const LIST_MARKER = /^([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const TAB_STOP = 4;
/** Indentation (in columns, past the container) that makes a line indented code. */
const CODE_INDENT = 4;

/** The index of the next run of exactly `size` backticks at or after `from`, or -1. */
export function closingRun(text: string, from: number, size: number): number {
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

/**
 * `text` with its HTML comments removed (each replaced by one space), given whether a comment is already open at
 * its start; also whether one is still open at its end. Code spans and backslash escapes are kept as written, and a
 * `<!--` inside them starts nothing. `<!-->` and `<!--->` are complete comments, as in CommonMark.
 */
export function stripComments(text: string, open: boolean): { text: string; open: boolean } {
  let out = '';
  let i = 0;
  let inComment = open;
  while (i < text.length) {
    if (inComment) {
      const end = text.indexOf('-->', i);
      if (end === -1) return { text: out, open: true };
      out += ' ';
      i = end + 3;
      inComment = false;
    } else if (text[i] === '\\') {
      out += text.slice(i, i + 2);
      i += 2;
    } else if (text[i] === '`') {
      let runEnd = i;
      while (text[runEnd] === '`') runEnd += 1;
      const close = closingRun(text, runEnd, runEnd - i);
      const end = close === -1 ? runEnd : close + (runEnd - i);
      out += text.slice(i, end);
      i = end;
    } else if (text.startsWith('<!--', i)) {
      inComment = true;
      i += 2; // so `<!-->` and `<!--->` close at once
    } else {
      out += text[i] ?? '';
      i += 1;
    }
  }
  return { text: out, open: inComment };
}

/** The column of the first non-blank character (tabs advance to the next multiple of four). */
function indentOf(text: string): number {
  let column = 0;
  for (const ch of text) {
    if (ch === ' ') column += 1;
    else if (ch === '\t') column += TAB_STOP - (column % TAB_STOP);
    else break;
  }
  return column;
}

/** `text` with its first `columns` columns of indentation removed. */
function dedent(text: string, columns: number): string {
  let column = 0;
  let i = 0;
  while (i < text.length && column < columns && (text[i] === ' ' || text[i] === '\t')) {
    column += text[i] === '\t' ? TAB_STOP - (column % TAB_STOP) : 1;
    i += 1;
  }
  return text.slice(i);
}

/** The content column of a list item starting at `indent` with `rest` after the indentation, or null. */
function listContentColumn(indent: number, rest: string): number | null {
  const marker = LIST_MARKER.exec(rest);
  if (marker === null) return null;
  const width = marker[1]?.length ?? 0;
  const spaces = marker[2]?.length ?? 0;
  // CommonMark: one to four spaces after the marker set the content column; none or five-plus count as one.
  return indent + width + (spaces >= 1 && spaces <= TAB_STOP ? spaces : 1);
}

interface State {
  fence: string | null;
  comment: boolean;
  block: number;
  indentedCode: boolean;
  /** Content columns of the open list items, innermost last. */
  lists: number[];
  /** Whether the previous line was paragraph text, which indented code cannot interrupt (a lazy line continues). */
  paragraph: boolean;
}

/** Closes the list items that a non-blank line at `indent` does not continue (a lazy paragraph line continues). */
function closeLists(state: State, indent: number, rest: string): void {
  const startsBlock = LIST_MARKER.test(rest) || ATX.test(rest) || FENCE_OPEN.test(rest);
  if (state.paragraph && !startsBlock) return;
  while (state.lists.length > 0 && indent < (state.lists.at(-1) ?? 0)) state.lists.pop();
}

/** One line outside fences and comments: the code line it is, the prose line it leaves, or null (a fence). */
function outsideLine(state: State, line: DocLine): CodeLine | DocLine | null {
  if (line.text.trim() === '') {
    state.paragraph = false;
    return line;
  }
  const indent = indentOf(line.text);
  closeLists(state, indent, line.text.trimStart());
  const base = state.lists.at(-1) ?? 0;
  if (indent - base >= CODE_INDENT && !state.paragraph) {
    if (!state.indentedCode) state.block += 1;
    state.indentedCode = true;
    return { n: line.n, text: dedent(line.text, base + CODE_INDENT), block: state.block, kind: 'indented' };
  }
  state.indentedCode = false;
  const fence = FENCE_OPEN.exec(line.text)?.[1];
  if (fence !== undefined) {
    state.fence = fence;
    state.block += 1;
    state.paragraph = false;
    return null;
  }
  const stripped = stripComments(line.text, false);
  state.comment = stripped.open;
  const rest = dedent(stripped.text, base);
  const column = listContentColumn(indentOf(stripped.text), rest.trimStart());
  if (column !== null && indent - base < CODE_INDENT) state.lists.push(column);
  state.paragraph = stripped.text.trim() !== '' && !ATX.test(rest);
  return { n: line.n, text: stripped.text };
}

/** Splits a document into prose lines (HTML comments removed) and code lines (fence delimiters are neither). */
export function splitBlocks(source: string): Blocks {
  const prose: DocLine[] = [];
  const code: CodeLine[] = [];
  const state: State = {
    fence: null,
    comment: false,
    block: 0,
    indentedCode: false,
    lists: [],
    paragraph: false,
  };
  source.split(/\r?\n/).forEach((text, index) => {
    const line = { n: index + 1, text };
    if (state.fence !== null) {
      const close = FENCE_CLOSE.exec(text)?.[1];
      const fence = state.fence;
      if (close?.startsWith(fence.charAt(0)) === true && close.length >= fence.length) state.fence = null;
      else code.push({ ...line, block: state.block, kind: 'fenced' });
      return;
    }
    if (state.comment) {
      // Inside a multi-line comment: nothing shows; the text after its `-->` is prose.
      const stripped = stripComments(text, true);
      state.comment = stripped.open;
      state.paragraph = false;
      prose.push({ n: line.n, text: stripped.open ? '' : stripped.text });
      return;
    }
    const result = outsideLine(state, line);
    if (result === null) return;
    if ('kind' in result) code.push(result);
    else prose.push(result);
  });
  return { prose, code };
}
