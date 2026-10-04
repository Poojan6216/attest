/**
 * Reading an opened Gmail conversation for the receipt parsers (sprint_2 2.3; tests/fixtures/pages/README.md "What
 * the pages model"). Pure over the DOM: it reads `doc`, returns data, and never writes, focuses, scrolls or
 * dispatches anything (Hard Rule 3). Landmarks come from ./selectors.json: role, aria-*, data-* and structure only.
 *
 * Is a conversation open? Any one of three signals says so: the page address names a thread (`#inbox/<id>`), the
 * main landmark holds the subject heading, or it holds a message. When none does, the view is a list (or settings,
 * or anything else): there is nothing to read and nothing is wrong, so health stays OK (Hard Rule 6 must not cry
 * wolf on every list view). When one does, every landmark the parsers need must be there (the main landmark
 * first), so a Gmail markup change that breaks one landmark is caught by the others, and one that breaks every DOM
 * landmark by the address.
 *
 * The body is read lazily, line by line (`MessageView.lines`): a parser looks only for the total lines it needs and
 * keeps nothing but the amount it found. No body text is returned or stored (Hard Rule 2). A message is read under
 * its own conversation's subject heading: Gmail can keep an earlier conversation's view beside the open one. The
 * address names a thread as `#<view>/<id>`, or `#label/<name>/<id>` and `#search/<query>/<id>`; a bare
 * `#label/<name>` or `#search/<query>` is a list, however long its name.
 */
import { asciiLower, email, type EmailAddress } from '../../../core/normalize';
import { oneLine } from '../../text';
import { RECEIPT_SELECTORS } from './selectors';

const L = RECEIPT_SELECTORS.landmarks;

/** What a parser-ready conversation needs; a missing one is reported as `selector.missing.<landmark>`. */
export type Landmark = 'main' | 'subject' | 'message' | 'sender' | 'date';

/**
 * One body line: the cells of a table row (two or more that hold text; spacer cells left out), or one run of an
 * innermost block (a `<br>` or a nested block ends a run); each cell on one line.
 */
export interface Line {
  readonly cells: readonly string[];
}

/** One expanded message of the opened conversation. */
export interface MessageView {
  /** Gmail's own message id (`data-legacy-message-id`); only its hash is kept (docs/grading.md §10). */
  readonly key: string;
  /** The subject heading of this message's own conversation, on one line. */
  readonly subject: string;
  /** The sender's address as `normalize.email` reads it, or null when it is not one address. */
  readonly sender: EmailAddress | null;
  /** The sender's display name, on one line ('' when none). Attacker-controlled: never matched for identity. */
  readonly senderName: string;
  /** The message date as Gmail states it: the date cell's `title`, else `alt`, else its text without "(… ago)". */
  readonly dateText: string;
  /** The body, line by line, read on demand. */
  readonly lines: () => Iterable<Line>;
}

export interface PageView {
  /** True when a conversation is open (any of the three signals above). */
  readonly opened: boolean;
  /** Landmarks a parser needs that the page lacks (only where a conversation is open). */
  readonly missing: readonly Landmark[];
  /** The expanded messages whose sender and date were found. */
  readonly messages: readonly MessageView[];
  /** The signed-in account's address, ASCII-lowercased, or null when the page shows none. */
  readonly account: string | null;
}

/** True when the page address's fragment names a conversation (`#inbox/FMfcg…`, `#search/q/<id>`). */
function threadInAddress(doc: Document): boolean {
  const url = doc.URL;
  const hash = url.indexOf('#');
  return hash >= 0 && RECEIPT_SELECTORS.threadUrl.test(url.slice(hash + 1));
}

/** The account switcher's address (`Google Account: Name (address)`), lowercased, or null. */
function accountOf(doc: Document): string | null {
  const label = doc.querySelector(L.account)?.getAttribute('aria-label') ?? '';
  const inside = /\(([^()]*)\)\s*$/u.exec(label)?.[1];
  const parsed = inside === undefined ? null : email(inside);
  return parsed === null ? null : asciiLower(parsed.address);
}

/** A block inside the message header (sender, date, recipients, buttons), or one that holds part of it. */
function inHeader(block: Element, item: Element): boolean {
  if (block.matches(L.header) || block.querySelector(L.header) !== null) return true;
  const mark = block.closest(L.header);
  return mark !== null && item.contains(mark);
}

/** DOM node types read here (`Node.ELEMENT_NODE`, `Node.TEXT_NODE`; the `Node` global is not in every runtime). */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** Elements whose text is never mail text (a style sheet in an email body is CSS, not a line). */
const NOT_TEXT = new Set(['style', 'script', 'template', 'noscript']);

const isElement = (node: Node): node is Element => node.nodeType === ELEMENT_NODE;

/**
 * The text of `root` in runs, each on one line: a `<br>` (at any depth) or the edge of a block inside `root` ends a
 * run. Only text nodes are read: a comment or a style sheet is not mail text.
 */
function runsOf(root: Element): string[] {
  const runs: string[] = [];
  let current = '';
  const cut = (): void => {
    runs.push(current);
    current = '';
  };
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) current += child.nodeValue ?? '';
      if (!isElement(child) || NOT_TEXT.has(child.localName)) continue;
      const edge = child.localName === 'br' || child.matches(L.blocks);
      if (edge) cut();
      visit(child);
      if (edge) cut();
    }
  };
  visit(root);
  cut();
  return runs.map(oneLine).filter((run) => run !== '');
}

/**
 * The cells of a body table row read as one line, or null when the row is not one: it holds another row (a layout
 * row), or fewer than two of its cells hold text. Empty cells (spacers, `&nbsp;`) are left out, so a label and its
 * amount stay side by side; a cell's own wrappers (`<p>`, `<div>`, `<br>`) join its text with one space.
 */
function rowCells(row: Element): string[] | null {
  if (row.localName !== 'tr' || row.querySelector('tr') !== null) return null;
  const cells = Array.from(row.children)
    .filter((cell) => cell.matches(L.cells))
    .map((cell) => runsOf(cell).join(' '))
    .filter((text) => text !== '');
  return cells.length >= 2 ? cells : null;
}

/**
 * The message body as lines, in document order. Lazy: nothing is read ahead. A table row with two or more cells
 * that hold text is one line (its cells), whatever wraps the text in them (`<td><p>Total</p></td>`); every
 * innermost block (a row's own wrappers included) is one line per run.
 */
function* bodyLines(item: Element): Generator<Line> {
  for (const block of Array.from(item.querySelectorAll(L.blocks))) {
    if (inHeader(block, item)) continue;
    const cells = rowCells(block);
    if (cells !== null) yield { cells };
    else if (block.querySelector(L.blocks) === null) yield* runsOf(block).map((run) => ({ cells: [run] }));
  }
}

function dateTextOf(date: Element): string {
  const stated = date.getAttribute('title') ?? date.getAttribute('alt');
  if (stated !== null && oneLine(stated) !== '') return oneLine(stated);
  return oneLine(date.textContent).replace(/\s*\([^()]*\)$/u, '');
}

/**
 * The message's date cell: a header grid cell that is not the sender's, the one with a `title` first. Found without
 * the `title`, so a date Gmail writes only as text ("Yesterday, 11:47 PM") is still read.
 */
function dateCell(item: Element, sender: Element | null): Element | null {
  const notSender = (cell: Element): boolean =>
    sender === null || (!cell.contains(sender) && !sender.contains(cell));
  const cells = Array.from(item.querySelectorAll(L.date)).filter(notSender);
  return cells.find((cell) => cell.hasAttribute('title')) ?? cells[0] ?? null;
}

/** `Node.DOCUMENT_POSITION_FOLLOWING`: the other node comes after this one in document order. */
const FOLLOWING = 4;

/**
 * The subject heading of the conversation `item` belongs to: among the headings of its nearest ancestor (up to the
 * main landmark) that holds any, the last one before it. Gmail can keep an earlier conversation's view in the page
 * beside the open one, so the first heading of the main landmark may be another conversation's subject, and a
 * message must never be classified by it (Hard Rule 5).
 */
function headingOf(item: Element, main: Element): Element | null {
  for (let node = item.parentElement; node !== null; node = node.parentElement) {
    const headings = Array.from(node.querySelectorAll(L.subject));
    const before = headings.filter((heading) => (heading.compareDocumentPosition(item) & FOLLOWING) !== 0);
    const heading = before.at(-1) ?? headings[0];
    if (heading !== undefined) return heading;
    if (node === main) return null;
  }
  return null;
}

function messageView(item: Element, main: Element, missing: Set<Landmark>): MessageView | null {
  const heading = headingOf(item, main);
  const sender = item.querySelector(L.sender);
  const date = dateCell(item, sender);
  if (heading === null) missing.add('subject');
  if (sender === null) missing.add('sender');
  if (date === null) missing.add('date');
  if (heading === null || sender === null || date === null) return null;
  return {
    key: item.getAttribute(L.messageKey) ?? '',
    subject: oneLine(heading.textContent),
    sender: email(sender.getAttribute(L.senderAddress) ?? ''),
    senderName: oneLine(sender.getAttribute(L.senderName) ?? sender.textContent),
    dateText: dateTextOf(date),
    lines: () => bodyLines(item),
  };
}

/** Reads the opened conversation, if any. Never throws for a page that lacks something: it reports it missing. */
export function readPage(doc: Document): PageView {
  const inAddress = threadInAddress(doc);
  const main = doc.querySelector(L.main);
  if (main === null)
    return { opened: inAddress, missing: inAddress ? ['main'] : [], messages: [], account: null };
  const items = Array.from(main.querySelectorAll(L.message));
  const heading = main.querySelector(L.subject);
  const opened = inAddress || items.length > 0 || heading !== null;
  if (!opened) return { opened, missing: [], messages: [], account: null };
  const missing = new Set<Landmark>();
  if (heading === null) missing.add('subject');
  if (items.length === 0) missing.add('message');
  const expanded = items.filter((item) => item.getAttribute(L.expanded) !== 'false');
  const messages = expanded.flatMap((item) => messageView(item, main, missing) ?? []);
  return { opened, missing: [...missing], messages, account: accountOf(doc) };
}
