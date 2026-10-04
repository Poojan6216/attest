/**
 * Finding the Sent list on a Gmail page (sprint_2 2.2; agents/adapter_engineer.md rules 2, 4; Hard Rules 3, 5, 6).
 * The one structural reader `health()`, `extract()` and `visibleWindow()` share, so all three see the same rows.
 *
 * The Sent list is read only when it is the view Gmail shows:
 *  1. the page address is Gmail's and its fragment routes to the Sent list (`#sent`, `#sent/p2`; ./route.ts).
 *     Any other folder → `not_sent_folder`; Sent with a conversation open → `not_sent_list`;
 *  2. the folder the nav marks as selected, when it marks one, is Sent, and the document title does not name
 *     another folder (otherwise Gmail is between two views and may still show the previous one);
 *  3. exactly one `role="main"` is shown, and exactly one `role="grid"` is shown inside it: Gmail keeps earlier
 *     views in the DOM, hidden, and a hidden Inbox list must never be read as the Sent list (./shown.ts);
 *  4. the grid has rows, and every row has the parts the extractor reads: one subject anchor carrying the row ids,
 *     at least one recipient (an `email` or `title` that is an address) in a cell before it, and a time element in
 *     a cell after it. A row missing one is a selector that broke, never a row to skip: skipping it would report
 *     its send as absent (Hard Rule 5). The reason names the landmark (Hard Rule 6).
 *
 * Anchors are role, aria-*, data-* and structure from ./selectors.json, never class names. Pure over the DOM: reads
 * attributes, text and computed style only.
 */
import { email } from '../../core/normalize';
import { oneLine } from '../text';
import { linkFolder, sentRoute } from './route';
import { SENT_SELECTORS } from './selectors';
import { shownOnly } from './shown';

const { selectors: S, attributes: A } = SENT_SELECTORS;

/** Every reason the Sent list can be unreadable: codes, never page text (Hard Rules 2, 10). */
export const SENT_PAGE_REASONS = Object.freeze([
  'location.not_gmail',
  'not_sent_folder',
  'not_sent_list',
  'selector.missing.main',
  'selector.ambiguous.main',
  'selector.missing.grid',
  'selector.ambiguous.grid',
  'selector.missing.row',
  'selector.missing.subject',
  'selector.ambiguous.subject',
  'selector.missing.cell',
  'selector.missing.recipient',
  'selector.missing.time',
  'row.recipient_invalid',
] as const);

export type SentPageReason = (typeof SENT_PAGE_REASONS)[number];

/** One list row, structurally checked. Values that need the pass instant (the time) are read by ./extract.ts. */
export interface SentRowParts {
  /** `data-legacy-last-message-id`: the vendor's row id (only its hash is kept, docs/grading.md §10). */
  readonly rowKey: string;
  readonly threadId: string | null;
  readonly lastNonDraftId: string | null;
  /** The element whose text is the subject. */
  readonly subject: Element;
  /** Each recipient's address, as read (case kept). */
  readonly recipients: readonly string[];
  /** The element carrying the row's time (`title`, `aria-label`, text). */
  readonly time: Element;
}

export type SentPage =
  | { readonly ok: true; readonly rows: readonly SentRowParts[]; readonly head: boolean }
  | { readonly ok: false; readonly reason: SentPageReason };

type Step<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: SentPageReason };

const fail = <T>(reason: SentPageReason): Step<T> => ({ ok: false, reason });

/** The folder each of `links` opens (`sent`, `inbox`, `label`), read against the page address. */
const foldersOf = (links: readonly Element[], doc: Document): string[] =>
  links.flatMap((link) => linkFolder(link.getAttribute('href') ?? '', doc.URL) ?? []);

/** True when `folders` names some folder and never Sent: a signal that another view is the one shown. */
const namesOtherFolder = (folders: readonly string[]): boolean =>
  folders.length > 0 && !folders.includes(SENT_SELECTORS.route.folder);

/**
 * The folders whose nav link `title` starts the document title: Gmail titles a list view "<the folder's nav title>
 * - <account> - Gmail" ("Inbox (3) - … - Gmail"). Only compared, never read as an instruction (rule 6).
 */
function titledFolders(doc: Document, links: readonly Element[]): string[] {
  const title = oneLine(doc.title);
  const named = links.filter((link) => {
    const name = oneLine(link.getAttribute(A.navTitle) ?? '');
    return name !== '' && title.startsWith(`${name}${SENT_SELECTORS.text.titleSeparator}`);
  });
  return foldersOf(named, doc);
}

/**
 * Steps 1 and 2: the route is the Sent list, and neither the nav's selected folder nor the document title names
 * another folder. Both are contradiction guards for the moment after the route changes, when Gmail may still show
 * the previous view (an Inbox drawn under `#sent` must never be read as sent mail, Hard Rule 5). A nav that marks
 * nothing, or a title that names no folder, leaves the route to decide. Its value is the list page.
 */
function activeSentPage(doc: Document): Step<number> {
  const route = sentRoute(doc.URL);
  if (route.kind === 'not_gmail') return fail('location.not_gmail');
  if (route.kind === 'other') return fail('not_sent_folder');
  if (route.kind === 'conversation') return fail('not_sent_list');
  const links = Array.from(doc.querySelectorAll(S.navLink));
  const selected = links.filter((link) => link.getAttribute(A.navSelected) === A.navSelectedValue);
  if (namesOtherFolder(foldersOf(selected, doc))) return fail('not_sent_folder');
  if (namesOtherFolder(titledFolders(doc, links))) return fail('not_sent_folder');
  return { ok: true, value: route.page };
}

/** Step 3: the one shown grid in the one shown main region. */
function shownGrid(doc: Document): Step<Element> {
  const mains = shownOnly(doc.querySelectorAll(S.main));
  const [main, ...otherMains] = mains;
  if (main === undefined) return fail('selector.missing.main');
  if (otherMains.length > 0) return fail('selector.ambiguous.main');
  const [grid, ...otherGrids] = shownOnly(main.querySelectorAll(S.grid));
  if (grid === undefined) return fail('selector.missing.grid');
  if (otherGrids.length > 0) return fail('selector.ambiguous.grid');
  return { ok: true, value: grid };
}

/** The row's own cells: grid cells of `row` not nested inside another of its cells. */
function cellsOf(row: Element): Element[] {
  return Array.from(row.querySelectorAll(S.cell)).filter((cell) => {
    const outer = cell.parentElement?.closest(S.cell) ?? null;
    return outer === null || !row.contains(outer);
  });
}

/** Recipient elements in `cells`: those matching the selector with no matching ancestor inside the same cell. */
function recipientElements(cells: readonly Element[]): Element[] {
  return cells.flatMap((cell) =>
    Array.from(cell.querySelectorAll(S.recipient)).filter((el) => {
      const outer = el.parentElement?.closest(S.recipient) ?? null;
      return outer === null || !cell.contains(outer);
    }),
  );
}

/** A recipient's address: the first of its `email`, `title` attributes that is present, if it is an address. */
function recipientAddress(element: Element): string | null {
  for (const name of A.recipient) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    return email(oneLine(value))?.address ?? null;
  }
  return null;
}

/** The time element: the first `title`/`aria-label` carrier in the first cell after the subject that has one. */
function timeElement(cells: readonly Element[]): Element | null {
  for (const cell of cells) {
    const found = cell.matches(S.time) ? cell : cell.querySelector(S.time);
    if (found !== null) return found;
  }
  return null;
}

/** Step 4 for one row. */
function rowParts(row: Element): Step<SentRowParts> {
  const anchors = Array.from(row.querySelectorAll(S.subject));
  const [subject, ...otherAnchors] = anchors;
  const rowKey = subject?.getAttribute(A.lastMessageId) ?? '';
  if (subject === undefined || rowKey === '') return fail('selector.missing.subject');
  if (otherAnchors.length > 0) return fail('selector.ambiguous.subject');
  const cells = cellsOf(row);
  const at = cells.findIndex((cell) => cell.contains(subject));
  if (at < 0) return fail('selector.missing.cell');
  const recipients = recipientElements(cells.slice(0, at));
  if (recipients.length === 0) return fail('selector.missing.recipient');
  const addresses = recipients.map(recipientAddress);
  if (!addresses.every((address): address is string => address !== null))
    return fail('row.recipient_invalid');
  const time = timeElement(cells.slice(at + 1));
  if (time === null) return fail('selector.missing.time');
  const threadId = subject.getAttribute(A.threadId);
  const lastNonDraftId = subject.getAttribute(A.lastNonDraftId);
  return { ok: true, value: { rowKey, threadId, lastNonDraftId, subject, recipients: addresses, time } };
}

/**
 * Whether the page is the head of the list (docs/grading.md §3: then the window ends at `lastSyncAt`): the first
 * page by route, and no shown `Newer` control that is enabled. Not seeing the control leaves the route to decide.
 */
function isHead(doc: Document, page: number): boolean {
  if (page !== 1) return false;
  const newer = shownOnly(doc.querySelectorAll(S.newer));
  return newer.every((control) => control.getAttribute(A.disabled) === 'true');
}

/** Reads the Sent list the page shows, or says why it cannot (steps 1 to 4 above). */
export function readSentPage(doc: Document): SentPage {
  const page = activeSentPage(doc);
  if (!page.ok) return page;
  const grid = shownGrid(doc);
  if (!grid.ok) return grid;
  const rows = Array.from(grid.value.querySelectorAll(S.row));
  if (rows.length === 0) return { ok: false, reason: 'selector.missing.row' };
  const parts: SentRowParts[] = [];
  for (const row of rows) {
    const read = rowParts(row);
    if (!read.ok) return read;
    parts.push(read.value);
  }
  return { ok: true, rows: parts, head: isHead(doc, page.value) };
}
