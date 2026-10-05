/**
 * Readers for the Google Calendar page (sprint_2 2.5): the landmarks, the visible days, the calendar list, the
 * page's own time-zone hint, the account switcher and the event chips. Read-only and pure over the DOM (Hard Rule
 * 3): every function here reads attributes, text and structure and returns data. Anchored on role, aria-*, data-*
 * and structure only (./selectors.json), never a class name.
 *
 * A chip's label is its accessible name: its `aria-label` when it has one, else its text outside every
 * `aria-hidden="true"` part. The `aria-hidden` part is what the chip draws; its lines are read only as candidate
 * titles (./label.ts), never as a whole, because it can draw the event's location.
 */
import { oneLine } from '../text';
import { GCAL_SELECTORS, MORE_PATTERN } from './selectors';
import { shownChecker, shownOnly } from './shown';
import { type CivilDay, civilDay, dayIso, nextDay, zoneHintMinutes } from './time';

const S = GCAL_SELECTORS.selectors;
const A = GCAL_SELECTORS.attributes;

/** One day the main grid shows. `complete` is false when the day hides events behind an "N more" button. */
export interface GridDay {
  readonly day: CivilDay;
  readonly iso: string;
  readonly complete: boolean;
}

/** The calendars the side panel lists, by name, and whether each is shown. */
export interface ListedCalendar {
  readonly name: string;
  readonly shown: boolean;
}

/** One event: every chip with its id (an event drawn across midnight is two chips, one event). */
export interface Chip {
  /** `data-eventid` as written. Never stored or posted: only its hash leaves (./read.ts). */
  readonly eventId: string;
  /** The accessible label, on one line; null when the event's chips disagree or one has none. */
  readonly label: string | null;
  /** The lines the chips draw (`aria-hidden` part), on one line each: candidate titles. */
  readonly titles: readonly string[];
  /** The days whose cells hold the event's chips (`YYYY-MM-DD`); empty when a chip sits in no day cell. */
  readonly days: readonly string[];
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function isHidden(el: Element): boolean {
  return el.getAttribute(A.hidden) === 'true';
}

/**
 * The one shown `role="main"` landmark, or why there is none to read: `missing`, or `ambiguous` when two are shown.
 * A hidden one (a view the app keeps in the DOM after the user left it) is never read (Hard Rule 5).
 */
export function mainOf(doc: Document): Element | 'missing' | 'ambiguous' {
  const [main, ...others] = shownOnly(doc.querySelectorAll(S.main));
  if (main === undefined) return 'missing';
  return others.length > 0 ? 'ambiguous' : main;
}

/**
 * True while the page is still drawing the range it shows: the shown `role="main"`, one of its shown grids, or an
 * ancestor of either says `aria-busy="true"`, or a shown progress bar sits in `role="main"`. A half-drawn week read
 * as it stands would report every event not yet drawn as deleted (Hard Rule 5), so a busy page is not read at all:
 * its pass is health OK with no rows, no coverage and no snapshot, and the mutations that end the drawing start
 * the next pass (src/observers/batch.ts). Busy is never a fault, so it is never DEGRADED (Hard Rule 6 must not cry
 * wolf on every week the user opens). A page with no single shown main is not busy: `health()` names what is wrong.
 */
export function pageBusy(doc: Document): boolean {
  const main = mainOf(doc);
  if (typeof main === 'string') return false;
  if ([main, ...gridsOf(main)].some((el) => el.closest(S.busy) !== null)) return true;
  return shownOnly(main.querySelectorAll(S.progress)).length > 0;
}

/**
 * The shown grids in `role="main"` (the side panel's mini month is another grid, outside it). A view may split its
 * days over several (an all-day grid and a timed one); a year view draws one per month, so the days of every grid
 * are read together (`gridDays`) and a year is too long to read (./read.ts `range.too_long`).
 */
export function gridsOf(main: Element): Element[] {
  return shownOnly(main.querySelectorAll(S.grid));
}

/** `((year - 1970) << 9) | (month << 5) | day` → the day, or null. */
export function dayOfKey(text: string | null): CivilDay | null {
  if (text === null || !/^\d{1,7}$/u.test(text)) return null;
  const key = Number(text);
  return civilDay((key >> 9) + 1970, (key >> 5) & 15, key & 31);
}

/**
 * A control that says a day hides events ("2 more", "+2 more"): any button or link outside an event chip whose
 * label or text says so. Read broadly on purpose: a false "hides events" only narrows coverage, a missed one would
 * report a day as seen whole when it was not (Hard Rule 5).
 */
function isMoreControl(el: Element): boolean {
  if (el.closest(S.chip) !== null) return false;
  return MORE_PATTERN.test(oneLine(el.getAttribute(A.label) ?? el.textContent));
}

function hidesEvents(cell: Element): boolean {
  return Array.from(cell.querySelectorAll(S.dayButton)).some(isMoreControl);
}

/** A "more" control in `main` that sits in no day: which day hides events cannot be told, so none is whole. */
function strayMore(main: Element): boolean {
  return Array.from(main.querySelectorAll(S.dayButton)).some(
    (el) => isMoreControl(el) && el.closest(S.day) === null,
  );
}

/**
 * True when the shown `role="main"` holds a "more" control outside every day: a layout the reader does not know,
 * where no day can be vouched for. Unlike days that each hide events behind their own "N more" (a page read
 * whole, with nothing wrong), its windows are unknown (./observer.ts), so the pass is DEGRADED (Hard Rule 6).
 */
export function moreOutsideDays(doc: Document): boolean {
  const main = mainOf(doc);
  return typeof main !== 'string' && strayMore(main);
}

/** The shown day cells of `grids`, by day; null when a day key is not a date. */
function cellsByDay(grids: readonly Element[]): Map<string, { day: CivilDay; complete: boolean }> | null {
  const byIso = new Map<string, { day: CivilDay; complete: boolean }>();
  const shown = shownChecker();
  for (const grid of grids) {
    for (const cell of shownOnly(grid.querySelectorAll(S.day), shown)) {
      const day = dayOfKey(cell.getAttribute(A.dayKey));
      if (day === null) return null;
      const iso = dayIso(day);
      byIso.set(iso, { day, complete: (byIso.get(iso)?.complete ?? true) && !hidesEvents(cell) });
    }
  }
  return byIso;
}

/**
 * The days the shown grids of `main` show, in order, or null when a day key is not a date, the days are not
 * consecutive, or there are none. A day is complete unless one of its cells has an "N more" control; none is when
 * such a control sits in no day.
 */
export function gridDays(main: Element, grids: readonly Element[]): GridDay[] | null {
  const byIso = cellsByDay(grids);
  if (byIso === null) return null;
  const whole = !strayMore(main);
  const days = [...byIso.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([iso, { day, complete }]) => ({ day, iso, complete: whole && complete }));
  for (let i = 1; i < days.length; i += 1) {
    const previous = days[i - 1];
    const following = previous === undefined ? null : nextDay(previous.day);
    if (following === null || dayIso(following) !== days[i]?.iso) return null;
  }
  return days.length === 0 ? null : days;
}

/** `<first day>/<last day>` of the main grid's days, or null when the page shows no readable range. */
export function visibleRange(doc: Document): string | null {
  const main = mainOf(doc);
  if (typeof main === 'string') return null;
  const days = gridDays(main, gridsOf(main));
  const first = days?.[0];
  const last = days?.[days.length - 1];
  return first === undefined || last === undefined ? null : `${first.iso}/${last.iso}`;
}

/** The side panel's calendar list, or null when the page shows none. */
export function calendarsOf(doc: Document): ListedCalendar[] | null {
  const boxes = Array.from(doc.querySelectorAll(S.calendar));
  if (boxes.length === 0) return null;
  return boxes.map((box) => ({
    name: oneLine(box.getAttribute(A.label) ?? ''),
    shown: box.getAttribute(A.checked) === 'true',
  }));
}

/** Every UTC offset (minutes) a "GMT-04" hint in `role="main"` names, outside the event chips. */
export function zoneHints(main: Element): number[] {
  const hints: number[] = [];
  for (const el of Array.from(main.querySelectorAll('*'))) {
    if (el.childElementCount > 0 || el.closest(S.chip) !== null) continue;
    const minutes = zoneHintMinutes(oneLine(el.textContent));
    if (minutes !== null) hints.push(minutes);
  }
  return hints;
}

/**
 * The signed-in account's address from the account switcher (`Google Account: Name (address)`): the text in its
 * last parentheses; '' when the switcher shows no address (the pass is then DEGRADED `account.invalid`); null when
 * the page has no switcher.
 */
export function accountOf(doc: Document): string | null {
  const prefix = GCAL_SELECTORS.text.accountPrefix;
  const link = Array.from(doc.querySelectorAll(S.account)).find((el) =>
    oneLine(el.getAttribute(A.label) ?? '').startsWith(prefix),
  );
  if (link === undefined) return null;
  const label = oneLine(link.getAttribute(A.label) ?? '');
  return /\(([^()]+)\)$/u.exec(label)?.[1]?.trim() ?? '';
}

/** The text of `node` outside every `aria-hidden="true"` part, as textContent joins it. */
function spokenText(node: Node): string {
  let text = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) text += child.textContent ?? '';
    else if (isElement(child) && !isHidden(child)) text += spokenText(child);
  }
  return text;
}

/** The lines a chip draws: the leaf elements of its `aria-hidden` parts. */
function drawnLines(chip: Element): string[] {
  const parts = Array.from(chip.querySelectorAll(`[${A.hidden}="true"]`));
  const leaves = parts.flatMap((part) =>
    part.childElementCount === 0 ? [part] : Array.from(part.querySelectorAll('*')),
  );
  return leaves
    .filter((el) => el.childElementCount === 0)
    .map((el) => oneLine(el.textContent))
    .filter((line) => line.length > 0);
}

function chipLabel(chip: Element): string {
  const aria = chip.getAttribute(A.label);
  return oneLine(aria !== null && aria.trim() !== '' ? aria : spokenText(chip));
}

/**
 * The shown event chips in `role="main"`, one entry per `data-eventid`, in page order. A hidden chip (in a view the
 * app keeps hidden, or one it hides) is not on the page the user sees, so it is not read.
 */
export function chipsOf(main: Element): Chip[] {
  const byId = new Map<
    string,
    { labels: Set<string>; titles: string[]; days: Set<string>; homeless: boolean }
  >();
  for (const el of shownOnly(main.querySelectorAll(S.chip), shownChecker())) {
    const eventId = el.getAttribute(A.eventId) ?? '';
    const entry = byId.get(eventId) ?? { labels: new Set(), titles: [], days: new Set(), homeless: false };
    entry.labels.add(chipLabel(el));
    entry.titles.push(...drawnLines(el));
    const day = dayOfKey(el.closest(S.day)?.getAttribute(A.dayKey) ?? null);
    if (day === null) entry.homeless = true;
    else entry.days.add(dayIso(day));
    byId.set(eventId, entry);
  }
  return [...byId.entries()].map(([eventId, entry]) => {
    const [only] = entry.labels;
    const label = entry.labels.size === 1 && only !== undefined && only !== '' ? only : null;
    const days = entry.homeless ? [] : [...entry.days].sort();
    return { eventId, label, titles: [...new Set(entry.titles)], days };
  });
}
