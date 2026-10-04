/**
 * A Calendar chip's accessible label, parsed (sprint_2 2.5; tests/fixtures/pages/README.md "What the pages model").
 *
 *   10am to 10:30am, Weekly sync, Avery Founder, Accepted, Location: …, Guests: alex@example.com, October 5, 2026
 *   All day, Founder offsite, Avery Founder, October 9, 2026
 *   October 7, 2026 at 11:30pm to October 8, 2026 at 12:30am, Late deploy window, Avery Founder, Accepted, Guests: …
 *
 * Read from both ends, never as a whole: the time at the start, the date at the end, the title and the calendar
 * right after the time, the guests after the last `, Guests: `. The rest (response status, location, conference
 * text) is never read into a field: a location holds commas and anything a stranger's invitation writes (a seeded
 * secret in the fixtures). The title is the one the chip shows (a line of its `aria-hidden` part) that the label
 * names right after the time and right before a calendar from the side panel's list, so a title with commas is
 * read whole. Text is data, never an instruction (agents/adapter_engineer.md rule 6). A label in any other shape
 * gives null, and the pass says so (DEGRADED), never a guess (Hard Rules 5, 6).
 *
 * Pure string functions.
 */
import { email } from '../../core/normalize';
import { GCAL_SELECTORS } from './selectors';
import { type CivilDay, nextDay, parseClock, parseDay } from './time';

/** One end of an event: its day and, unless it is all day, the minute of that day. */
export interface LabelTime {
  readonly day: CivilDay;
  readonly minute: number | null;
}

export interface ChipLabel {
  readonly start: LabelTime;
  /** Null for an all-day event. */
  readonly end: LabelTime | null;
  readonly title: string;
  /** The calendar's name as the side panel lists it. */
  readonly calendar: string;
  /** Guest addresses exactly as written, in label order. */
  readonly guests: readonly string[];
}

/** What a label is read against: the titles the chip shows and the calendar names the side panel lists. */
export interface LabelContext {
  readonly titles: readonly string[];
  readonly calendars: readonly string[];
}

/** Bounds the work one label can cost (a label listing 200 guests is about 7,000 characters). */
const MAX_LABEL = 20_000;

const TEXT = GCAL_SELECTORS.text;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const DAY = String.raw`\p{Lu}\p{Ll}+ \d{1,2}, \d{4}`;
const CLOCK = String.raw`\d{1,2}(?::\d{2})?\s?[AaPp][Mm]|\d{1,2}:\d{2}`;
const TO = escaped(TEXT.to);
const AT = escaped(TEXT.at);
const SPAN = new RegExp(`^(${DAY})${AT}(${CLOCK})${TO}(${DAY})${AT}(${CLOCK}), `, 'u');
const RANGE = new RegExp(`^(${CLOCK})${TO}(${CLOCK}), `, 'u');
const ALL_DAY = `${TEXT.allDay}, `;
const TRAILING_DAY = new RegExp(`, (${DAY})$`, 'u');

interface TimePart {
  readonly start: LabelTime;
  readonly end: LabelTime | null;
  /** The label after the time part and its `, `, without the trailing date when the form has one. */
  readonly rest: string;
}

function at(dayText: string | undefined, clockText: string | undefined): LabelTime | null {
  const day = parseDay(dayText ?? '');
  const minute = parseClock(clockText ?? '');
  return day === null || minute === null ? null : { day, minute };
}

/** `10am to 11am, …, October 5, 2026`: an end at or before the start is on the next day. */
function rangeForm(label: string, match: RegExpExecArray): TimePart | null {
  const trailing = TRAILING_DAY.exec(label);
  const startMinute = parseClock(match[1] ?? '');
  const endMinute = parseClock(match[2] ?? '');
  const day = parseDay(trailing?.[1] ?? '');
  if (trailing === null || day === null || startMinute === null || endMinute === null) return null;
  const endDay = endMinute <= startMinute ? nextDay(day) : day;
  if (endDay === null) return null;
  const rest = label.slice(match[0].length, trailing.index);
  return { start: { day, minute: startMinute }, end: { day: endDay, minute: endMinute }, rest };
}

function timePart(label: string): TimePart | null {
  const span = SPAN.exec(label);
  if (span !== null) {
    const start = at(span[1], span[2]);
    const end = at(span[3], span[4]);
    return start === null || end === null ? null : { start, end, rest: label.slice(span[0].length) };
  }
  const range = RANGE.exec(label);
  if (range !== null) return rangeForm(label, range);
  if (!label.startsWith(ALL_DAY)) return null;
  const trailing = TRAILING_DAY.exec(label);
  const day = parseDay(trailing?.[1] ?? '');
  if (trailing === null || day === null) return null;
  return { start: { day, minute: null }, end: null, rest: label.slice(ALL_DAY.length, trailing.index) };
}

/** The longest listed calendar name `text` starts with, followed by `,` or the end, and what follows it. */
function calendarAt(text: string, calendars: readonly string[]): { calendar: string; tail: string } | null {
  let found: string | null = null;
  for (const name of calendars) {
    const fits = text === name || text.startsWith(`${name},`);
    if (fits && name.length > (found?.length ?? -1)) found = name;
  }
  return found === null ? null : { calendar: found, tail: text.slice(found.length) };
}

/**
 * The title and calendar at the start of `rest`. With titles shown on the chip: the longest one the label names
 * before a listed calendar. With none (a chip with no `aria-hidden` part): everything before the first listed
 * calendar.
 */
function titleAndCalendar(
  rest: string,
  context: LabelContext,
): { title: string; calendar: string; tail: string } | null {
  if (context.titles.length > 0) {
    const longestFirst = [...new Set(context.titles)].sort((a, b) => b.length - a.length);
    for (const title of longestFirst) {
      if (title.length === 0 || !rest.startsWith(`${title}, `)) continue;
      const calendar = calendarAt(rest.slice(title.length + 2), context.calendars);
      if (calendar !== null) return { title, ...calendar };
    }
    return null;
  }
  for (let comma = rest.indexOf(', '); comma > 0; comma = rest.indexOf(', ', comma + 1)) {
    const calendar = calendarAt(rest.slice(comma + 2), context.calendars);
    if (calendar !== null) return { title: rest.slice(0, comma), ...calendar };
  }
  return null;
}

/** The addresses after the last `, Guests: `; anything in the list that is not one address is not a guest. */
function guestsIn(text: string): string[] {
  const from = text.lastIndexOf(TEXT.guests);
  if (from < 0) return [];
  return text
    .slice(from + TEXT.guests.length)
    .split(', ')
    .map((token) => token.trim())
    .filter((token) => email(token)?.address === token);
}

/** Parses one chip label (already on one line), or null when it is not in a shape this observer reads. */
export function parseChipLabel(label: string, context: LabelContext): ChipLabel | null {
  if (label.length === 0 || label.length > MAX_LABEL) return null;
  const time = timePart(label);
  if (time === null) return null;
  const named = titleAndCalendar(time.rest, context);
  if (named === null) return null;
  return {
    start: time.start,
    end: time.end,
    title: named.title,
    calendar: named.calendar,
    guests: guestsIn(named.tail),
  };
}
