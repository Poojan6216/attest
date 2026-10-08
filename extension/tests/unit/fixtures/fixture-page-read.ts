/**
 * Reference readers for the observer fixtures: an independent reading of what a page shows, so the labels can be
 * checked against the page they describe (tests/unit/fixtures/fixture-pages.spec.ts). Not observer code and never
 * imported by it: the observers (sprint 2.2, 2.3, 2.5) are measured against the labels, and these readers keep the
 * labels honest (Hard Rule 12: a field-accuracy number is only as true as its labels).
 *
 * The page model is the one tests/fixtures/pages/README.md describes (role, aria-*, data-* and structure only).
 * Times go through `normalize.resolveRelative` in the page's IANA zone, so a label written with the wrong UTC
 * offset (a DST change, a midnight row) fails here whatever zone the test machine runs in.
 */
import type { Document, Element } from 'happy-dom';

import { type OffsetAt, resolveRelative } from '../../../src/core/normalize';

export const collapse = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/gu, ' ').trim();

/** The UTC offset (minutes) of an IANA zone at an instant, from the runtime's time-zone data. */
export function zoneOffset(timeZone: string): OffsetAt {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  return (epochMs: number) => {
    const part = (type: string): number =>
      Number(format.formatToParts(new Date(epochMs)).find((p) => p.type === type)?.value);
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    return Math.round((wall - Math.floor(epochMs / 1000) * 1000) / 60_000);
  };
}

const NUMERIC_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/u;

/**
 * Gmail's visible date for a row from an earlier year, numeric and month first in English ("11/25/25": real capture,
 * 2026-10-06), as "November 25, 2025", which `resolveRelative` reads; any other text unchanged. The observer reads
 * the absolute `title` first, so this is only for checking that the visible text agrees with it.
 */
export function longDate(text: string): string {
  const [, month = '', day = '', year = ''] = NUMERIC_DATE.exec(text) ?? [];
  const name = MONTHS[Number(month) - 1];
  return name === undefined ? text : `${name} ${Number(day)}, ${2000 + Number(year)}`;
}

/** `text` read at `readAt` in `timeZone`: the precision unit it names, or null. */
export function timeOf(text: string, readAt: string, timeZone: string) {
  return resolveRelative(text, { referenceIso: readAt, offsetAt: zoneOffset(timeZone) });
}

const HIDDEN_CLASSES = new WeakMap<Document, Set<string>>();

/**
 * Classes the page's own stylesheet hides visually (the 1px clip pattern of screen-reader-only text), read once per
 * document: the check runs for every seed, row and recipient of a page (real captures carry no stylesheet, so theirs
 * is empty; the hand-built pages carry their own).
 */
function visuallyHiddenClasses(doc: Document): Set<string> {
  const known = HIDDEN_CLASSES.get(doc);
  if (known) return known;
  const css = Array.from(doc.querySelectorAll('style'), (style) => style.textContent).join('\n');
  const hidden = new Set<string>();
  for (const rule of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/gu)) {
    const [, name = '', body = ''] = rule;
    if (/\bclip(?:-path)?\s*:/u.test(body) && /\b1px\b/u.test(body)) hidden.add(name);
  }
  HIDDEN_CLASSES.set(doc, hidden);
  return hidden;
}

/** Whether `el` is drawn on screen: no ancestor is `hidden`, `display: none`, `visibility: hidden` or clipped. */
export function isShown(el: Element, doc: Document): boolean {
  const hidden = visuallyHiddenClasses(doc);
  for (let at: Element | null = el; at; at = at.parentElement) {
    if (at.hasAttribute('hidden')) return false;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/u.test(at.getAttribute('style') ?? '')) return false;
    if ((at.getAttribute('class') ?? '').split(/\s+/u).some((name) => hidden.has(name))) return false;
  }
  return true;
}

// ── Gmail ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The folder whose nav link is selected (`tabindex="0"`), from its `#fragment`. */
export function selectedFolder(doc: Document): string | null {
  const link = doc.querySelector('[role="navigation"] a[href*="#"][tabindex="0"]');
  return /#([a-z]+)$/u.exec(link?.getAttribute('href') ?? '')?.[1] ?? null;
}

/** The `/mail/u/<n>/` account path the page's own folder links use. */
export function accountPaths(doc: Document): string[] {
  const hrefs = Array.from(
    doc.querySelectorAll('[role="navigation"] a[href]'),
    (a) => a.getAttribute('href') ?? '',
  );
  return [...new Set(hrefs.map((href) => /\/mail\/u\/\d+\//u.exec(href)?.[0] ?? ''))];
}

/** Whether the list's `Newer` button is off (the page is the head of the list); null when there is none. */
export function newerDisabled(doc: Document): boolean | null {
  const newer = doc.querySelector('[role="main"] [role="button"][aria-label="Newer"]');
  return newer ? newer.getAttribute('aria-disabled') === 'true' : null;
}

export interface SentRow {
  /** The subject anchor's `data-legacy-last-message-id`. */
  readonly key: string;
  readonly threadId: string;
  readonly lastNonDraftId: string;
  /**
   * The row stands for a conversation of several messages, whose time is its newest message's, not a send's (grading
   * v1.13): a draft is newer than its last message, or the row shows a message count, or its thread id differs from
   * its last message's and the page shows no count at all (then ids alone decide). A thread id older than the
   * message's with no count, on a page that shows counts, is a mail composed as a draft first: one message (live
   * smoke, 2026-10-07).
   */
  readonly conversation: boolean;
  /** The message count shown after the recipients ("11"), or null. */
  readonly count: number | null;
  readonly recipients: readonly string[];
  readonly subject: string;
  /** The time cell's absolute `title`, when the row has one. */
  readonly timeTitle: string | null;
  /** The time cell's visible text ("9:41 AM", "Oct 2"). */
  readonly timeText: string;
}

/**
 * Every row of the list grid in `role="main"`, read from what it shows: real Gmail repeats a row's recipients and
 * subject anchor in a `display: none` summary for screen readers (capture of 2026-10-06), which is not the row.
 */
export function sentRows(doc: Document): SentRow[] {
  const read = Array.from(doc.querySelectorAll('[role="main"] [role="grid"] [role="row"]'), (row) => {
    const subject = Array.from(row.querySelectorAll('[data-legacy-last-message-id]')).find((el) =>
      isShown(el, doc),
    );
    const cells = Array.from(row.querySelectorAll('[role="gridcell"]'));
    const timeCell = cells[cells.length - 1];
    const shownRecipients = Array.from(row.querySelectorAll('[data-hovercard-id]')).filter((span) =>
      isShown(span, doc),
    );
    return {
      key: subject?.getAttribute('data-legacy-last-message-id') ?? '',
      threadId: subject?.getAttribute('data-legacy-thread-id') ?? '',
      lastNonDraftId: subject?.getAttribute('data-legacy-last-non-draft-message-id') ?? '',
      count: shownCount(shownRecipients, doc),
      recipients: shownRecipients.map((span) =>
        collapse(span.getAttribute('email') ?? span.getAttribute('title')),
      ),
      subject: collapse(subject?.textContent),
      timeTitle: timeCell?.querySelector('[title]')?.getAttribute('title') ?? null,
      timeText: collapse(timeCell?.textContent),
    };
  });
  const countsShown = read.some((row) => row.count !== null);
  return read.map((row) => ({
    ...row,
    conversation:
      row.lastNonDraftId !== row.key || row.count !== null || (row.threadId !== row.key && !countsShown),
  }));
}

/** The count shown right after a row's recipients: a shown sibling of the last one whose text is a number. */
function shownCount(recipients: readonly Element[], doc: Document): number | null {
  const last = recipients[recipients.length - 1];
  for (let next = last?.nextElementSibling ?? null; next !== null; next = next.nextElementSibling) {
    const text = collapse(next.textContent);
    if (/^[1-9]\d{0,3}$/u.test(text) && isShown(next, doc)) return Number(text);
  }
  return null;
}

/**
 * Whether `address` is the account's own mailbox, written independently of the observers' rule: compared in ASCII
 * lower case, without a `+tag`, and, at gmail.com or googlemail.com, without dots in the local part.
 */
export function ownMailbox(address: string, account: string): boolean {
  const box = (raw: string): string => {
    const [local = '', domain = ''] = raw.trim().toLowerCase().split('@');
    const base = local.split('+')[0] ?? '';
    const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
    return gmail ? `${base.replace(/\./gu, '')}@gmail.com` : `${base}@${domain}`;
  };
  return address.includes('@') && box(address) === box(account);
}

/** Whether the list provably ends on this page: it shows an `Older` control and every one it shows is disabled. */
export function olderDisabled(doc: Document): boolean {
  const older = Array.from(doc.querySelectorAll('[role="button"][aria-label="Older"]')).filter((button) =>
    isShown(button, doc),
  );
  return older.length > 0 && older.every((button) => button.getAttribute('aria-disabled') === 'true');
}

// ── Google Calendar ───────────────────────────────────────────────────────────────────────────────────────

export interface Chip {
  readonly key: string;
  /** The accessible text: the chip's text outside its `aria-hidden` part. */
  readonly label: string;
}

/** Event chips in `role="main"`, one per `data-eventid` (an event drawn across midnight is one event). */
export function chips(doc: Document): Chip[] {
  const byKey = new Map<string, Chip>();
  for (const chip of Array.from(doc.querySelectorAll('[role="main"] [role="button"][data-eventid]'))) {
    const key = chip.getAttribute('data-eventid') ?? '';
    const spoken = Array.from(chip.children).filter((child) => child.getAttribute('aria-hidden') !== 'true');
    if (!byKey.has(key)) byKey.set(key, { key, label: collapse(spoken.map((c) => c.textContent).join(' ')) });
  }
  return [...byKey.values()];
}

const CHIP_DATE = /, ([A-Z][a-z]+ \d{1,2}, \d{4})$/u;
const CHIP_SPAN = /^([A-Z][a-z]+ \d{1,2}, \d{4}) at (\d{1,2}(?::\d{2})?[ap]m) to /u;
const CHIP_CLOCK = /^(\d{1,2})(?::(\d{2}))?([ap]m) to /u;

/** The event start a chip label names, in the page zone (an all-day event: local midnight), or null. */
export function chipStart(
  label: string,
  readAt: string,
  timeZone: string,
): { start: string; allDay: boolean } | null {
  const date = CHIP_DATE.exec(label)?.[1];
  if (label.startsWith('All day, ')) {
    const day = date === undefined ? null : timeOf(date, readAt, timeZone);
    return day?.precision === 'day' ? { start: day.start, allDay: true } : null;
  }
  const span = CHIP_SPAN.exec(label);
  const clock = CHIP_CLOCK.exec(label);
  const text = span
    ? `${span[1] ?? ''} at ${span[2] ?? ''}`
    : `${date ?? ''} at ${clock?.[1] ?? ''}:${clock?.[2] ?? '00'}${clock?.[3] ?? ''}`;
  const time = timeOf(text, readAt, timeZone);
  return time?.precision === 'minute' ? { start: time.start, allDay: false } : null;
}

/** The guest addresses a chip label lists after `Guests:`. */
export function chipGuests(label: string): string[] {
  const list = /, Guests: (.*?)(?:, [A-Z][a-z]+ \d{1,2}, \d{4})?$/u.exec(label)?.[1] ?? '';
  return list.split(', ').filter((guest) => guest.includes('@'));
}

/**
 * The side panel's calendar list: name and whether it is shown. Real Google Calendar draws native checkboxes
 * (capture of 2026-10-06), whose ticked state the capture tool writes into `checked`.
 */
export function calendarList(doc: Document): { name: string; checked: boolean }[] {
  return Array.from(
    doc.querySelectorAll(
      '[role="complementary"] [role="list"] [role="checkbox"], [role="complementary"] [role="list"] input[type="checkbox"]',
    ),
    (box) => ({
      name: collapse(box.getAttribute('aria-label')),
      checked:
        box.localName === 'input' ? box.hasAttribute('checked') : box.getAttribute('aria-checked') === 'true',
    }),
  );
}

/**
 * Whether the page is still drawing its range: `role="main"` or a grid in it says `aria-busy="true"`, a progress
 * bar is shown in it, or the side panel's calendar lists are drawn but all still empty (real Calendar fills them
 * seconds after the grid). Such a page is not read: health OK, no events, no coverage.
 */
export function stillDrawing(doc: Document): boolean {
  const main = doc.querySelector('[role="main"]');
  if (!main) return false;
  const busy = [main, ...Array.from(main.querySelectorAll('[role="grid"]'))].some(
    (el) => el.closest('[aria-busy="true"]') !== null,
  );
  const progress = Array.from(main.querySelectorAll('[role="progressbar"]')).some((bar) => isShown(bar, doc));
  const lists = Array.from(doc.querySelectorAll('[role="complementary"] [role="list"][aria-label]'));
  return busy || progress || (lists.length > 0 && lists.every((list) => list.childElementCount === 0));
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The days the main grid shows (`data-datekey`, `((year - 1970) << 9) | (month << 5) | day`), in order, each
 * as "Month D, YYYY" and whether it hides events behind an "N more" button.
 */
export function gridDays(doc: Document): { date: string; more: boolean }[] {
  const cells = Array.from(doc.querySelectorAll('[role="main"] [role="grid"] [data-datekey]'));
  const keys = [...new Set(cells.map((cell) => Number(cell.getAttribute('data-datekey'))))].sort(
    (a, b) => a - b,
  );
  return keys.map((key) => {
    const more = cells
      .filter((cell) => Number(cell.getAttribute('data-datekey')) === key)
      .some((cell) =>
        Array.from(cell.querySelectorAll('[role="button"]')).some((button) =>
          /^\d+ more\b/u.test(collapse(button.textContent)),
        ),
      );
    return { date: `${MONTHS[((key >> 5) & 15) - 1] ?? ''} ${key & 31}, ${(key >> 9) + 1970}`, more };
  });
}

/** Contiguous runs of fully visible days as [local midnight, next local midnight) windows in the page zone. */
export function dayWindows(
  days: readonly { date: string; more: boolean }[],
  readAt: string,
  timeZone: string,
) {
  const windows: { windowStart: string; windowEnd: string }[] = [];
  let open: { windowStart: string; windowEnd: string } | null = null;
  for (const { date, more } of days) {
    const day = timeOf(date, readAt, timeZone);
    if (more || day?.precision !== 'day') {
      open = null;
      continue;
    }
    if (open) open.windowEnd = day.end;
    else windows.push((open = { windowStart: day.start, windowEnd: day.end }));
  }
  return windows;
}
