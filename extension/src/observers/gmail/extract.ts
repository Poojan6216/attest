/**
 * Gmail Sent extraction (sprint_2 2.2; build_spec §7 adapter contract; agents/adapter_engineer.md rules 4 to 8).
 * Pure over the DOM: reads the rows ./sent-page.ts found, returns raw rows, mutates and dispatches nothing.
 *
 * One raw row per recipient (docs/grading.md §10: the counterparty is part of the content hash), each holding only
 * the fields `gmail.sent` allowlists: `counterparty` (the address exactly as read), `subjectHint` (one line, at most
 * 80 code points, none for an empty subject or Gmail's "(no subject)") and `occurredAt` (./sent-time.ts). The
 * account's own mailbox is never a counterparty (../own-address.ts: any case, a `+tag`, Gmail's dots), as the
 * Calendar reader leaves it out of guests: the address leaves the content script only as its hash
 * (docs/privacy-architecture.md §6; Hard Rule 2). A claim naming the account can then match no row, so a row that
 * names the account narrows the window like a conversation row (below): such a claim is UNVERIFIABLE, never NOT_FOUND
 * (Hard Rule 5; a real Sent page held a send to the account, capture of 2026-10-06). `rowKey`
 * is the row's `data-legacy-last-message-id`, so the same row read on two scrolls is one observation, and two
 * identical sends stay two. The snippet, the screen-reader summary and every other text on the row are never read
 * (Hard Rule 2). Subject text is data, never an instruction or a selector (rule 6).
 *
 * A row whose send time cannot be read (./sent-time.ts) is returned as a row without content. `redact.project`
 * refuses it (`redact.missing_occurred_at`), so the pass is DEGRADED and writes no coverage while the rows it could
 * read still count as evidence: the 2.0 contract (src/observers/plan.ts; Sprint 1 close, SEC-3; Hard Rule 5). A
 * conversation of several messages (./sent-time.ts) gives no row: the list cannot time the user's sends in it.
 *
 * The visible window (docs/grading.md §3) ends at the pass instant at the head of the list (`#sent`, `Newer` off),
 * else at the newest row's time. It starts at the oldest row's minute when the page is provably the last of the
 * list (an `Older` control, disabled), and one minute later whenever the list may go on (QA-1): Gmail shows a send's
 * time to the minute only, so a send in that same minute that is older than the oldest row is on the next page, and
 * the pass never saw it. The rows of that minute are still posted: they are evidence, only the span is narrowed. A
 * head whose every row is in the minute being read and whose list goes on sees no whole minute, so it asserts no
 * window (never one that ends before it starts). The window is null when the page is not the Sent list or any
 * row's time is unknown: an unread row could be the oldest or the newest.
 *
 * Coverage (`sentWindows`; sprint_2 2.7; Hard Rule 5): only the head of the list asserts its window. Any other
 * Sent page posts its rows and no coverage, by design (OK, never DEGRADED). In conversation view Gmail lists a
 * thread once, under its latest message: a send from a later page's span whose thread later got a reply is listed
 * on an earlier page, under the reply's date, so that span is not every send in it. The head lists every thread
 * whose latest message is at or after its oldest row. A conversation row's sends were made at or before its own
 * minute, so the window starts one minute after the newest conversation row (real capture of 2026-10-06), and the
 * newest row that names the account: every send in the window is then a one-message row the pass timed and can match
 * to a claim. A conversation row whose time cannot be read leaves the window unknown, and so does a list whose shown
 * minutes go up anywhere down the page: the window rests on the list being in order of its shown minutes, newest
 * first (true of every real capture), so a list out of order vouches for nothing (tech re-review, TECH-R8).
 *
 * Each row's time is read once per pass and context: the rows and the window share it (TECH-2).
 */
import { instantMs, isoWithOffset } from '../../core/normalize';
import { clampSubjectHint } from '../../core/redact';
import { MS_PER_MINUTE } from '../../core/units';
import { oneLine } from '../text';
import { isOwnAddress } from '../own-address';
import type { ExtractContext, RawRow, VisibleWindow } from '../types';
import { gmailAccount } from './account';
import { type SentList, sentPageOf, type SentRowParts } from './sent-page';
import { type RowTime, rowTime } from './sent-time';
import { SENT_SELECTORS } from './selectors';

const NO_SUBJECT: ReadonlySet<string> = new Set(SENT_SELECTORS.text.noSubject);

/** The row's subject hint: one line, cut to 80 code points; undefined for an empty or "(no subject)" subject. */
export function subjectHintOf(subject: Element): string | undefined {
  const line = oneLine(subject.textContent);
  return line === '' || NO_SUBJECT.has(line) ? undefined : clampSubjectHint(line);
}

/** Each row's time (./sent-time.ts `rowTime`), per list read and pass context. */
const TIMES = new WeakMap<SentList, WeakMap<ExtractContext, readonly RowTime[]>>();

function timesOf(list: SentList, ctx: ExtractContext): readonly RowTime[] {
  let byContext = TIMES.get(list);
  if (byContext === undefined) {
    byContext = new WeakMap<ExtractContext, readonly RowTime[]>();
    TIMES.set(list, byContext);
  }
  const known = byContext.get(ctx);
  if (known !== undefined) return known;
  // The list draws message counts when some row shows one; only then is a row with none one message (./sent-time.ts).
  const countsShown = list.rows.some((row) => row.messageCount !== null);
  const times = list.rows.map((row) => rowTime(row, ctx, countsShown));
  byContext.set(ctx, times);
  return times;
}

/** Whether the row names the account among its recipients (header: it narrows the window). */
const namesAccount = (row: SentRowParts, account: string | null): boolean =>
  row.recipients.some((address) => isOwnAddress(address, account));

function rawRows(row: SentRowParts, time: RowTime, account: string | null): RawRow[] {
  // A conversation's sends cannot be timed from the list: no row, and the window starts after it (spanOf).
  if (time.kind === 'conversation') return [];
  // Refused by project() (no occurredAt): the pass says DEGRADED instead of dropping a send in silence.
  if (time.kind === 'unreadable') return [{ type: 'email.sent', rowKey: row.rowKey, fields: {} }];
  const occurredAt = time.at;
  const subjectHint = subjectHintOf(row.subject);
  const others = row.recipients.filter((address) => !isOwnAddress(address, account));
  return others.map((counterparty) => ({
    type: 'email.sent',
    rowKey: row.rowKey,
    fields:
      subjectHint === undefined ? { counterparty, occurredAt } : { counterparty, subjectHint, occurredAt },
  }));
}

/** `Observer.extract`: the raw rows of the Sent list the page shows; none on any other page. */
export function extractSent(doc: Document, ctx: ExtractContext): RawRow[] {
  const list = sentPageOf(doc);
  if (!list.ok) return [];
  const times = timesOf(list, ctx);
  // Health refuses a page whose account it cannot read, so a pass extracts only with the account known.
  const account = gmailAccount(doc);
  return list.rows.flatMap((row, at) => rawRows(row, times[at] ?? { kind: 'unreadable' }, account));
}

/** The row's minute as the list shows it (a send's, or a conversation's newest), or null when unreadable. */
const minuteOf = (time: RowTime): string | null =>
  time.kind === 'send' ? time.at : time.kind === 'conversation' ? time.latest : null;

/** The list's oldest and newest minutes, and the newest minute of a row no claim can be matched to (header). */
interface ListMinutes {
  readonly oldest: string;
  readonly newest: string;
  readonly unmatched: string | null;
}

/**
 * Reads the minute of every row of `list` (header): null when one is unknown, or when the list is out of order (a
 * minute later than the row above it). A conversation row and a row that names the account are `unmatched`.
 */
function minutesOf(list: SentList, ctx: ExtractContext, account: string | null): ListMinutes | null {
  let oldest: string | null = null;
  let newest: string | null = null;
  let unmatched: string | null = null;
  for (const [at, time] of timesOf(list, ctx).entries()) {
    const minute = minuteOf(time);
    if (minute === null) return null;
    const ms = instantMs(minute);
    if (oldest !== null && ms > instantMs(oldest)) return null;
    oldest = minute;
    newest ??= minute;
    const row = list.rows[at];
    const hides = time.kind === 'conversation' || (row !== undefined && namesAccount(row, account));
    if (hides && (unmatched === null || ms > instantMs(unmatched))) unmatched = minute;
  }
  return oldest === null || newest === null ? null : { oldest, newest, unmatched };
}

/** The list's span (header); `none` when it holds no whole minute; null when it cannot be known. */
function spanOf(list: SentList, ctx: ExtractContext, account: string | null): VisibleWindow | 'none' | null {
  const minutes = minutesOf(list, ctx, account);
  if (minutes === null) return null;
  const { oldest, newest, unmatched } = minutes;
  const windowEnd = list.head ? ctx.observedAt : newest;
  const startMs = Math.max(
    instantMs(oldest) + (list.mayContinue ? MS_PER_MINUTE : 0),
    unmatched === null ? Number.NEGATIVE_INFINITY : instantMs(unmatched) + MS_PER_MINUTE,
  );
  const endMs = instantMs(windowEnd);
  // No whole minute after the oldest row (QA-1) and the newest unmatched row was seen.
  if (startMs > endMs && instantMs(oldest) <= endMs) return 'none';
  if (startMs === instantMs(oldest)) return { windowStart: oldest, windowEnd };
  return { windowStart: isoWithOffset(startMs, ctx.offsetAt(startMs)), windowEnd };
}

/** The span the list shows (header), or null when it shows none whole or it cannot be known. */
export function sentWindow(doc: Document, ctx: ExtractContext): VisibleWindow | null {
  const list = sentPageOf(doc);
  if (!list.ok) return null;
  const span = spanOf(list, ctx, gmailAccount(doc));
  return span === 'none' ? null : span;
}

/**
 * `Observer.visibleWindows`: the head of the Sent list asserts its span; any other Sent page asserts none, by
 * design (header), and so does a head that holds no whole minute. Null when the page is not the Sent list, or the
 * head's span cannot be known (`window.unknown`).
 */
export function sentWindows(doc: Document, ctx: ExtractContext): VisibleWindow[] | null {
  const list = sentPageOf(doc);
  if (!list.ok) return null;
  if (!list.head) return [];
  const span = spanOf(list, ctx, gmailAccount(doc));
  if (span === null) return null;
  return span === 'none' ? [] : [span];
}
