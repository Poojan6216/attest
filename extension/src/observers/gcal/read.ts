/**
 * One synchronous read of a Google Calendar page (sprint_2 2.5): every fact a pass reports, or the reasons it cannot
 * report any (Hard Rules 5, 6). `health()`, `extract()` and the windows all come from here, so they agree.
 *
 * DEGRADED, with nothing extracted and no coverage, when anything the extractor needs is missing or unreadable:
 *  - `selector.missing.main`, `selector.missing.grid`: no shown `role="main"` landmark, or no shown grid in it
 *    (schedule view). A hidden one (a view kept in the DOM after the user left it) is never read;
 *  - `selector.ambiguous.main`: two shown `role="main"` landmarks: which one the user sees cannot be told;
 *  - `range.invalid`: no visible day, a day key that is not a date, or days that are not consecutive;
 *  - `range.too_long`: more than six weeks, the days of every shown grid together (a year view draws a grid per
 *    month but no events: reading it would claim a year seen);
 *  - `selector.missing.calendar_list`: no calendar list, so a calendar switched off could not be told from a
 *    deleted event;
 *  - `time_zone.mismatch`: the page's "GMT-04" hint matches the browser's offset on none of the visible days.
 *    Calendar writes times in its own zone setting; its DST rules are not on the page, so a fixed offset would
 *    be a guess. Calendar's zone or the browser's must change (a month view has no hint: the browser's is used);
 *  - `time_zone.ambiguous`: the page shows two zone hints (Calendar's secondary time zone) and only one matches the
 *    browser's offset. Labels are written in the primary zone, which the page does not mark, so a match with the
 *    secondary would read every time hours off;
 *  - `event.unreadable`: a chip whose label is not in a shape ./label.ts reads, whose chips disagree, that sits in
 *    no visible day, or whose label starts on a day after every day its chips sit in (a misread date);
 *  - `event.calendar_hidden`: a chip on a calendar the list says is off (the list cannot be trusted then);
 *  - `event.time_ambiguous`: a start or end that a DST change skips or repeats (no single instant);
 *  - `event.too_many`: more events than one bus batch.
 * One reason is the observer's, not the read's (./observer.ts): `page.busy`, a page still drawing its range after
 * BUSY_LIMIT_MS of passes, which is not read at all.
 * The account is read here to leave the user out of each event's guests, and kept in the facts so a pass reads it
 * once (TECH-2); the skeleton hashes it.
 */
import { asciiLower, type OffsetAt } from '../../core/normalize';
import { clampSubjectHint, hashRowKey, hashText } from '../../core/redact';
import { SCHEMA_LIMITS, type Sha256 } from '../../core/schema';
import { oneLineText } from '../../core/schema-text';
import { oneLine } from '../text';
import { type ChipLabel, parseChipLabel } from './label';
import {
  accountOf,
  calendarsOf,
  type Chip,
  chipsOf,
  type GridDay,
  gridDays,
  gridsOf,
  type ListedCalendar,
  mainOf,
  zoneHints,
} from './page';
import { GCAL_SELECTORS } from './selectors';
import { MAX_RANGE_DAYS } from './snapshot';
import { dayIso, dayStart, type Instant, localInstant, noonOffset } from './time';

/** Every reason code a Calendar read can give (the pass adds its own, src/observers/plan.ts PASS_REASONS). */
export const GCAL_REASONS = Object.freeze([
  'selector.missing.main',
  'selector.missing.grid',
  'selector.missing.calendar_list',
  'selector.ambiguous.main',
  'range.invalid',
  'range.too_long',
  'time_zone.mismatch',
  'time_zone.ambiguous',
  'event.unreadable',
  'event.calendar_hidden',
  'event.time_ambiguous',
  'event.too_many',
  'page.busy',
] as const);

export type GcalReason = (typeof GCAL_REASONS)[number];

/** One event as read. `eventId` is the vendor id and never leaves this module's callers' memory. */
export interface ReadEvent {
  readonly key: Sha256;
  readonly calendar: string;
  readonly subjectHint?: string;
  readonly occurredAt: string;
  readonly endAt?: string;
  readonly allDay: boolean;
  readonly days: readonly string[];
  readonly guests: readonly string[];
  readonly guestCount: number;
}

export interface PageFacts {
  readonly days: readonly GridDay[];
  readonly calendars: readonly ListedCalendar[];
  readonly events: readonly ReadEvent[];
  /**
   * The account switcher's address as ./page.ts `accountOf` reads it: null when the page names no account, '' when
   * it cannot tell which one. Never posted: only its hash leaves the content script (../account.ts).
   */
  readonly account: string | null;
}

export type PageRead =
  | { readonly ok: true; readonly facts: PageFacts }
  | { readonly ok: false; readonly reasons: readonly [GcalReason, ...GcalReason[]] };

const SubjectHint = oneLineText(SCHEMA_LIMITS.SUBJECT_HINT).min(1);
const Address = oneLineText(SCHEMA_LIMITS.COUNTERPARTY).min(1);

function failed(reason: GcalReason, ...rest: GcalReason[]): PageRead {
  return { ok: false, reasons: [reason, ...rest] };
}

function subjectOf(title: string): string | undefined | null {
  const line = oneLine(title);
  if (GCAL_SELECTORS.text.noTitle.includes(line)) return undefined;
  const parsed = SubjectHint.safeParse(clampSubjectHint(line));
  return parsed.success ? parsed.data : null;
}

/** Guests as written, the account left out, one per address (ASCII case folded), in ASCII-lowercase order. */
function guestsOf(label: ChipLabel, account: string | null): string[] {
  const own = account === null ? null : asciiLower(account);
  const byFolded = new Map<string, string>();
  for (const guest of label.guests) {
    const folded = asciiLower(guest);
    if (folded === own || byFolded.has(folded) || !Address.safeParse(guest).success) continue;
    byFolded.set(folded, guest);
  }
  return [...byFolded.entries()]
    .sort(([a, rawA], [b, rawB]) => (a === b ? (rawA < rawB ? -1 : 1) : a < b ? -1 : 1))
    .map(([, guest]) => guest);
}

/**
 * Whether the label's start day is one the chips sit in, or before them (an event that began earlier and continues
 * here). A start after every chip's day is a date read from the wrong part of the label: never a guess (Hard Rule 5).
 */
function startsByChip(label: ChipLabel, chip: Chip): boolean {
  const start = dayIso(label.start.day);
  return chip.days.some((day) => start <= day);
}

function instantOf(time: ChipLabel['start'], offsetAt: OffsetAt): Instant | null {
  return time.minute === null ? dayStart(time.day, offsetAt) : localInstant(time.day, time.minute, offsetAt);
}

interface EventContext {
  readonly calendars: readonly ListedCalendar[];
  readonly visible: ReadonlySet<string>;
  readonly account: string | null;
  readonly offsetAt: OffsetAt;
}

function readEvent(chip: Chip, ctx: EventContext): ReadEvent | GcalReason {
  if (chip.eventId === '' || chip.label === null || chip.days.length === 0) return 'event.unreadable';
  if (!chip.days.every((day) => ctx.visible.has(day))) return 'event.unreadable';
  const names = ctx.calendars.map((calendar) => calendar.name);
  const label = parseChipLabel(chip.label, { titles: chip.titles, calendars: names });
  if (label === null || !startsByChip(label, chip)) return 'event.unreadable';
  if (!ctx.calendars.some((c) => c.name === label.calendar && c.shown)) return 'event.calendar_hidden';
  const subjectHint = subjectOf(label.title);
  if (subjectHint === null) return 'event.unreadable';
  const start = instantOf(label.start, ctx.offsetAt);
  const end = label.end === null ? null : instantOf(label.end, ctx.offsetAt);
  if (start === null || (label.end !== null && end === null)) return 'event.time_ambiguous';
  if (end !== null && end.ms < start.ms) return 'event.unreadable';
  const guests = guestsOf(label, ctx.account);
  return {
    key: hashRowKey(chip.eventId),
    calendar: label.calendar,
    ...(subjectHint === undefined ? {} : { subjectHint }),
    occurredAt: start.iso,
    ...(end === null ? {} : { endAt: end.iso }),
    allDay: label.start.minute === null,
    days: chip.days,
    guests: guests.slice(0, SCHEMA_LIMITS.LIST),
    guestCount: guests.length,
  };
}

/**
 * Why the page's "GMT±hh" hints disagree with `offsetAt`, or null when they agree: every distinct hint must be the
 * browser's offset on at least one visible day. None matching is `time_zone.mismatch`; some but not all (a secondary
 * time zone shown beside the primary one) is `time_zone.ambiguous`. A page with no hint is read in the browser zone.
 */
function zoneProblem(main: Element, days: readonly GridDay[], offsetAt: OffsetAt): GcalReason | null {
  const hints = [...new Set(zoneHints(main))];
  const offsets = new Set(days.map((day) => noonOffset(day.day, offsetAt)));
  const matching = hints.filter((hint) => offsets.has(hint)).length;
  if (matching === hints.length) return null;
  return matching === 0 ? 'time_zone.mismatch' : 'time_zone.ambiguous';
}

function readEvents(main: Element, ctx: EventContext): ReadEvent[] | GcalReason[] {
  const chips = chipsOf(main);
  if (chips.length > SCHEMA_LIMITS.BATCH) return ['event.too_many'];
  const events: ReadEvent[] = [];
  const reasons = new Set<GcalReason>();
  for (const chip of chips) {
    const event = readEvent(chip, ctx);
    if (typeof event === 'string') reasons.add(event);
    else events.push(event);
  }
  return reasons.size > 0 ? [...reasons].sort() : events;
}

function isReasons(list: ReadEvent[] | GcalReason[]): list is GcalReason[] {
  return list.some((item) => typeof item === 'string');
}

/**
 * Reads the page: its facts, or why a pass must not report any. `account` is the page's account as `accountOf` reads
 * it, when the caller already read it (one read per pass).
 */
export function readCalendar(
  doc: Document,
  offsetAt: OffsetAt,
  account: string | null = accountOf(doc),
): PageRead {
  const main = mainOf(doc);
  if (main === 'missing') return failed('selector.missing.main');
  if (main === 'ambiguous') return failed('selector.ambiguous.main');
  const grids = gridsOf(main);
  if (grids.length === 0) return failed('selector.missing.grid');
  const days = gridDays(main, grids);
  if (days === null) return failed('range.invalid');
  if (days.length > MAX_RANGE_DAYS) return failed('range.too_long');
  const calendars = calendarsOf(doc);
  if (calendars === null) return failed('selector.missing.calendar_list');
  const zone = zoneProblem(main, days, offsetAt);
  if (zone !== null) return failed(zone);
  const visible = new Set(days.map((day) => day.iso));
  const events = readEvents(main, { calendars, visible, account: account === '' ? null : account, offsetAt });
  if (isReasons(events)) {
    const [first, ...rest] = events;
    return first === undefined ? failed('event.unreadable') : failed(first, ...rest);
  }
  return { ok: true, facts: { days, calendars, events, account } };
}

/** The calendar key a snapshot stores for a calendar name. */
export function calendarKey(name: string): Sha256 {
  return hashText(name);
}
