/**
 * Claims from an activity log the person pastes (sprint_3 3.11; docs/claims-import.md). Attest reads no agent's site
 * (Decisions [3.10]): the person copies the agent's own log of what it did and pastes it into the side panel, which
 * calls `readPastedLog` there and nowhere else. Pure: text in, entries and claims out, no DOM, no clock.
 *
 * A log is read line by line (docs/claims-import.md §3):
 *  - a line that names only a day ("Today", "Yesterday", a weekday, "Oct 7") is a heading for the entries below it;
 *    a heading that names a period or a date in digits ("Earlier", "Last week", "10/6/2026"), or any other line made
 *    only of date words and numbers that names no one day ("September 2026", "2 weeks ago", "Last Thursday", "Oct
 *    1st"), is one whose day is unknown (Sprint 3 QA review GAP 1);
 *  - a line that is only a clock time ("4:33 pm", "16:33") ends the entry above it, which happened then, on its
 *    heading's day, also when a copy put full-width digits or an invisible character in it (QA review GAP 2); a line
 *    that names a time with its own day ("Yesterday, 4:33 pm", "5 minutes ago") does the same, read as it is;
 *  - a line that starts with a clock time and a separator ("4:33 PM · Sent the invoice") is an entry of its own; a
 *    time anywhere else in a line ("for Friday at 12:30 pm") is part of its text;
 *  - a blank line ends the entry above it, which then has only its heading's day;
 *  - every other line is text of the current entry (a title, the sentence that says what was done).
 * An entry gets a time only from a day the paste names (Hard Rule 5): a clock time with no day heading above it is
 * "no day", and an entry with no time at all, or one right above a day heading (which could be its own time or the
 * next section's), is "no time". Neither is imported, and the preview says why.
 * Each entry is held to the claim builder an agent adapter uses (./claims.ts `buildFacts`, ./patterns.ts): one claim
 * per ActionType it reports (a title and its summary are one action: the one naming most facts is kept), at most one
 * `other` when it reports none, the §10 ids, so pasting the same log twice gives the same claims. A time that cannot be read, or one after the paste, gives no claim either. The text
 * never leaves the side panel: only the claims are sent on (Hard Rule 2).
 */
import { importExtractorId } from '../config';
import { asciiLower, instantMs, type OffsetAt, resolveRelative } from '../core/normalize';
import { MONTH_NAMES, WEEKDAY_NAMES } from '../core/normalize-names';
import { type AgentId, type Claim, type IsoTs, SCHEMA_LIMITS } from '../core/schema';
import { oneLine } from '../observers/text';
import { buildFacts, statedTime } from './claims';

/**
 * The parser's version: every pasted claim's `extractor.version`, beside the id `import.<agent>`. 1.1.0 (Sprint 3 close):
 * date-only headings are unplaced, time lines read after folding and dropping invisible characters, the paste read in
 * NFC, a move's start read after its last "to", and a log over GRADING_INPUT timed entries refused.
 */
export const PASTE_VERSION = '1.1.0';
/** The longest paste read; a longer one is refused, never cut. */
export const MAX_PASTE_CHARS = 100_000;

export interface PasteContext {
  readonly agent: AgentId;
  /** When the person pasted: every claim's `observedAt`, and the reference for "Today" and "5 minutes ago". */
  readonly pastedAt: IsoTs;
  readonly offsetAt: OffsetAt;
}

/** What became of one entry of the log, for the preview. */
export type EntryOutcome =
  /** It reports at least one claim (`claims`). */
  | 'claim'
  /** It reports a claim and shows a clock time, but the paste names no day for it: not imported (Hard Rule 5). */
  | 'no_day'
  /** It reports a claim, but has no time Attest can read, or one after the paste: not imported (Hard Rule 5). */
  | 'no_time'
  /** It reports nothing Attest checks (a search, a note, chatter). */
  | 'no_claim'
  /** A claim failed its schema: a bug, never expected. */
  | 'invalid';

export interface PastedEntry {
  /** The entry's lines as pasted, for the preview only. */
  readonly text: string;
  /** Its time as the log gives it, after its heading's day when it has one ("Today, 4:33 pm"), or null. */
  readonly time: string | null;
  /**
   * The minute it names at minute precision, a claim or not: kept as a time the agent was working (`activeAt`, a
   * session ping), which the preview says (security review SEC-4); null when it names none.
   */
  readonly minute: IsoTs | null;
  readonly outcome: EntryOutcome;
  readonly claims: readonly Claim[];
}

export interface PastedLog {
  readonly entries: readonly PastedEntry[];
  /** Every entry's claims, each once (the same claim reported twice is one). */
  readonly claims: readonly Claim[];
  /**
   * The minutes the log's timed entries name, a claim or not, each once and in order: when the agent's own log says it
   * worked, the session pings attribution reads (sprint_3 3.14; docs/grading.md §7). A day, or no time, names none.
   */
  readonly activeAt: readonly IsoTs[];
}

/** Why a paste was refused as a whole. */
export type PasteRefusal = 'empty' | 'too_long' | 'too_many_claims' | 'too_many_times';

export type PasteResult =
  { readonly ok: true; readonly log: PastedLog } | { readonly ok: false; readonly refusal: PasteRefusal };

/** A clock time as a log writes one: "4:33 pm", "4:33PM", "4:33 p.m.", "16:33". */
const CLOCK = String.raw`\d{1,2}:\d{2}(?:\s?[ap]\.?m\.?)?`;
const BARE_CLOCK = new RegExp(String.raw`^${CLOCK}$`, 'iu');
const ANY_CLOCK = new RegExp(CLOCK, 'iu');
/** A clock time, a separator, then the entry's text; not a time range ("9:00 - 9:30 ..."). */
const LEADING_CLOCK = new RegExp(
  String.raw`^(?<clock>${CLOCK})\s*[-|\u00b7\u2022\u2013\u2014]\s*(?<text>(?!\d{1,2}:\d{2})\S.*)$`,
  'iu',
);
/** A heading that names a period, or a date in digits, rather than one day: its entries' day is unknown. */
const UNPLACED_HEADING =
  /^(?:earlier|older|(?:earlier )?(?:this|last|previous|past) (?:week|month|year)|(?:last|previous|past) \d+ days|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4})$/iu;

/** The words a heading naming a period or a date is made of, beside numbers (QA review GAP 1). */
const DATE_WORDS: ReadonlySet<string> = new Set([
  ...[
    'ago',
    'last',
    'this',
    'next',
    'previous',
    'past',
    'earlier',
    'later',
    'today',
    'yesterday',
    'tomorrow',
  ],
  ...[
    'day',
    'days',
    'week',
    'weeks',
    'month',
    'months',
    'year',
    'years',
    'a',
    'an',
    'one',
    'of',
    'the',
    'on',
  ],
  ...WEEKDAY_NAMES.flat(),
  ...MONTH_NAMES.flat(),
]);
/** A number a date heading can hold: a day, an ordinal day ("1st") or a year. */
const DATE_NUMBER = /^\d{1,4}(?:st|nd|rd|th)?$/u;

/**
 * Whether `line`, which the resolver does not read as one day, is only date words and numbers: a heading that names a
 * period or a date ("September 2026", "2 weeks ago", "Last Thursday", "Oct 1st"), never an entry's text. Under it, an
 * entry's day is unknown, so it is never read on the day of a heading above it (Hard Rule 5).
 */
function namesOnlyADate(line: string): boolean {
  const words = asciiLower(line)
    .split(/[\s,.]+/u)
    .filter((word) => word !== '');
  return words.length > 0 && words.every((word) => DATE_WORDS.has(word) || DATE_NUMBER.test(word));
}

/** Characters a copy can carry inside a time that show as nothing: zero-width ones, joiners, the soft hyphen, the BOM. */
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u2060-\u2064\ufeff]/gu;

/**
 * A line as its time is read (QA review GAP 2): compatibility forms folded, so full-width digits and colon are a clock,
 * and invisible characters dropped, as the resolver reads it. A line whose clock only these hide is still a clock.
 */
const timeForm = (line: string): string => line.normalize('NFKC').replace(INVISIBLE, '');

type Line =
  | { readonly kind: 'blank' }
  | { readonly kind: 'heading'; readonly heading: Heading }
  | { readonly kind: 'clock'; readonly clock: string }
  | { readonly kind: 'stamp'; readonly time: string }
  | { readonly kind: 'entry'; readonly text: string; readonly clock: string }
  | { readonly kind: 'text'; readonly text: string };

/** A day heading as written, and whether it names one day the resolver reads. */
interface Heading {
  readonly text: string;
  readonly placed: boolean;
}

/** An entry's time: as the log shows it (for the preview), and as the claim builder reads it (null: no claim). */
interface When {
  readonly shown: string | null;
  readonly time: string | null;
}

interface Draft extends When {
  readonly text: string;
}

const NO_TIME: When = { shown: null, time: null };

/** What one line of the log is, read against the paste instant. */
function lineOf(raw: string, ctx: PasteContext): Line {
  const line = oneLine(raw);
  if (line === '') return { kind: 'blank' };
  if (UNPLACED_HEADING.test(line)) return { kind: 'heading', heading: { text: line, placed: false } };
  const plain = timeForm(line);
  if (BARE_CLOCK.test(plain)) return { kind: 'clock', clock: plain };
  const alone = resolveRelative(line, { referenceIso: ctx.pastedAt, offsetAt: ctx.offsetAt });
  if (alone !== null) {
    // A time with its clock read as a whole day (one that happened twice as the clocks went back) is still a time.
    return alone.precision === 'day' && !ANY_CLOCK.test(plain)
      ? { kind: 'heading', heading: { text: line, placed: true } }
      : { kind: 'stamp', time: line };
  }
  if (namesOnlyADate(plain)) return { kind: 'heading', heading: { text: line, placed: false } };
  const inline = LEADING_CLOCK.exec(plain)?.groups;
  if (inline?.clock !== undefined && inline.text !== undefined) {
    return { kind: 'entry', text: inline.text, clock: inline.clock };
  }
  return { kind: 'text', text: line };
}

/** The day an entry without a time of its own has: its heading's, when the heading names one. */
const dayOf = (heading: Heading | null): When =>
  heading?.placed === true ? { shown: heading.text, time: heading.text } : NO_TIME;

/** A clock time on its heading's day, as the resolver reads one ("Yesterday, 4:33 pm"); no time without a day. */
function clockOf(heading: Heading | null, clock: string): When {
  const shown = heading === null ? clock : `${heading.text}, ${clock}`;
  return { shown, time: heading?.placed === true ? shown : null };
}

/** The log's entries: each one's text lines and its time (rules in the module comment). */
function draftsOf(text: string, ctx: PasteContext): Draft[] {
  const drafts: Draft[] = [];
  let heading: Heading | null = null;
  let pending: string[] = [];
  const flush = (when: When): void => {
    if (pending.length > 0) drafts.push({ text: pending.join('\n'), ...when });
    pending = [];
  };
  for (const raw of text.split(/\r\n|[\n\r\u2028\u2029]/u)) {
    const line = lineOf(raw, ctx);
    if (line.kind === 'blank') flush(dayOf(heading));
    else if (line.kind === 'heading') {
      flush(NO_TIME);
      heading = line.heading;
    } else if (line.kind === 'clock') flush(clockOf(heading, line.clock));
    else if (line.kind === 'stamp') flush({ shown: line.time, time: line.time });
    else if (line.kind === 'entry') {
      flush(dayOf(heading));
      drafts.push({ text: line.text, ...clockOf(heading, line.clock) });
    } else pending.push(line.text);
  }
  flush(dayOf(heading));
  return drafts;
}

/** How many facts a claim names that grading matches on: who, what, how much, and when the event starts. */
const factsOf = (claim: Claim): number =>
  [claim.counterparty, claim.subjectHint, claim.amountCents, claim.targetAt].filter(
    (fact) => fact !== undefined,
  ).length;

/**
 * One claim per action type in an entry (sprint_3 3.15): a title and the sentence under it report one action, and two
 * claims of it would leave one NOT_FOUND once the other took its evidence (Hard Rule 5). The one naming the most facts
 * is kept, the later sentence on a tie (the summary comes after the title).
 */
function onePerType(claims: readonly Claim[]): Claim[] {
  const kept = new Map<string, Claim>();
  for (const claim of claims) {
    const held = kept.get(claim.type);
    if (held === undefined || factsOf(claim) >= factsOf(held)) kept.set(claim.type, claim);
  }
  return claims.filter((claim) => kept.get(claim.type) === claim);
}

/** One entry held to the claim builder: its claims, or why it gives none, and the minute it names. */
function readEntry(draft: Draft, ctx: PasteContext): PastedEntry {
  const read = {
    agent: ctx.agent,
    extractor: { id: importExtractorId(ctx.agent), version: PASTE_VERSION },
    observedAt: ctx.pastedAt,
    offsetAt: ctx.offsetAt,
  };
  const facts = buildFacts(
    { conversationId: null, turns: [], activity: [{ text: draft.text, time: draft.time }], scopes: null },
    read,
  );
  const stated = statedTime(draft.time, read);
  const untimed: EntryOutcome = draft.shown !== null && draft.time === null ? 'no_day' : 'no_time';
  const outcome: EntryOutcome =
    facts.claims.length > 0
      ? 'claim'
      : facts.untimed > 0
        ? untimed
        : facts.invalid > 0
          ? 'invalid'
          : 'no_claim';
  const minute = stated?.precision === 'minute' ? stated.at : null;
  return { text: draft.text, time: draft.shown, minute, outcome, claims: onePerType(facts.claims) };
}

/** The minutes the entries name at minute precision (`PastedLog.activeAt`), each once, in time order. */
function activeAtOf(entries: readonly PastedEntry[]): IsoTs[] {
  const minutes = new Map<number, IsoTs>();
  for (const { minute } of entries) if (minute !== null) minutes.set(instantMs(minute), minute);
  return [...minutes].sort(([a], [b]) => a - b).map(([, at]) => at);
}

/**
 * The entries and claims of a pasted log (rules in the module comment), or why the paste is refused as a whole: it
 * holds nothing, it is longer than MAX_PASTE_CHARS, it reports more claims than one import may carry
 * (SCHEMA_LIMITS.BATCH), or its timed entries name more minutes than one import carries (SCHEMA_LIMITS.GRADING_INPUT;
 * tech review TECH-3). Nothing is cut to fit, so every log it accepts is one `claims.import` message.
 */
export function readPastedLog(pasted: string, ctx: PasteContext): PasteResult {
  if (pasted.length > MAX_PASTE_CHARS) return { ok: false, refusal: 'too_long' };
  if (pasted.trim() === '') return { ok: false, refusal: 'empty' };
  // One form of the text, whatever the copy gave: the same log gives the same claims (QA review GAP 6).
  const drafts = draftsOf(pasted.normalize('NFC'), ctx);
  const entries = drafts.map((draft) => readEntry(draft, ctx));
  const claims = new Map<string, Claim>();
  for (const entry of entries) for (const claim of entry.claims) claims.set(claim.id, claim);
  if (claims.size > SCHEMA_LIMITS.BATCH) return { ok: false, refusal: 'too_many_claims' };
  const activeAt = activeAtOf(entries);
  if (activeAt.length > SCHEMA_LIMITS.GRADING_INPUT) return { ok: false, refusal: 'too_many_times' };
  return { ok: true, log: { entries, claims: [...claims.values()], activeAt } };
}
