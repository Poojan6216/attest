/**
 * Gmail Sent extraction (sprint_2 2.2; build_spec §7 adapter contract; agents/adapter_engineer.md rules 4 to 8).
 * Pure over the DOM: reads the rows ./sent-page.ts found, returns raw rows, mutates and dispatches nothing.
 *
 * One raw row per recipient (docs/grading.md §10: the counterparty is part of the content hash), each holding only
 * the fields `gmail.sent` allowlists: `counterparty` (the address exactly as read), `subjectHint` (one line, at most
 * 80 code points, none for an empty subject or Gmail's "(no subject)") and `occurredAt` (./sent-time.ts). `rowKey`
 * is the row's `data-legacy-last-message-id`, so the same row read on two scrolls is one observation, and two
 * identical sends stay two. The snippet, the screen-reader summary and every other text on the row are never read
 * (Hard Rule 2). Subject text is data, never an instruction or a selector (rule 6).
 *
 * A row whose send time cannot be read (./sent-time.ts) is returned as a row without content. `redact.project`
 * refuses it (`redact.missing_occurred_at`), so the pass is DEGRADED and writes no coverage while the rows it could
 * read still count as evidence: the 2.0 contract (src/observers/plan.ts; Sprint 1 close, SEC-3; Hard Rule 5).
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
 * whose latest message is at or after its oldest row, and a row holding more than one message is refused
 * (./sent-time.ts, so the pass asserts nothing): a send in the head's span is a row on the page.
 *
 * Each row's time is read once per pass and context: the rows and the window share it (TECH-2).
 */
import { instantMs, isoWithOffset } from '../../core/normalize';
import { clampSubjectHint } from '../../core/redact';
import { MS_PER_MINUTE } from '../../core/units';
import { oneLine } from '../text';
import type { ExtractContext, RawRow, VisibleWindow } from '../types';
import { type SentList, sentPageOf, type SentRowParts } from './sent-page';
import { sentAt } from './sent-time';
import { SENT_SELECTORS } from './selectors';

const NO_SUBJECT: ReadonlySet<string> = new Set(SENT_SELECTORS.text.noSubject);

/** The row's subject hint: one line, cut to 80 code points; undefined for an empty or "(no subject)" subject. */
export function subjectHintOf(subject: Element): string | undefined {
  const line = oneLine(subject.textContent);
  return line === '' || NO_SUBJECT.has(line) ? undefined : clampSubjectHint(line);
}

/** Each row's send time (null: unknown), per list read and pass context. */
const TIMES = new WeakMap<SentList, WeakMap<ExtractContext, readonly (string | null)[]>>();

function timesOf(list: SentList, ctx: ExtractContext): readonly (string | null)[] {
  let byContext = TIMES.get(list);
  if (byContext === undefined) {
    byContext = new WeakMap<ExtractContext, readonly (string | null)[]>();
    TIMES.set(list, byContext);
  }
  const known = byContext.get(ctx);
  if (known !== undefined) return known;
  const times = list.rows.map((row) => sentAt(row, ctx));
  byContext.set(ctx, times);
  return times;
}

function rawRows(row: SentRowParts, occurredAt: string | null): RawRow[] {
  // Refused by project() (no occurredAt): the pass says DEGRADED instead of dropping a send in silence.
  if (occurredAt === null) return [{ type: 'email.sent', rowKey: row.rowKey, fields: {} }];
  const subjectHint = subjectHintOf(row.subject);
  return row.recipients.map((counterparty) => ({
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
  return list.rows.flatMap((row, at) => rawRows(row, times[at] ?? null));
}

/** The list's span (header); `none` when it holds no whole minute; null when a row's time is unknown. */
function spanOf(list: SentList, ctx: ExtractContext): VisibleWindow | 'none' | null {
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const at of timesOf(list, ctx)) {
    if (at === null) return null;
    if (oldest === null || instantMs(at) < instantMs(oldest)) oldest = at;
    if (newest === null || instantMs(at) > instantMs(newest)) newest = at;
  }
  if (oldest === null || newest === null) return null;
  const windowEnd = list.head ? ctx.observedAt : newest;
  if (!list.mayContinue) return { windowStart: oldest, windowEnd };
  const startMs = instantMs(oldest) + MS_PER_MINUTE;
  const endMs = instantMs(windowEnd);
  // Every row is in the minute being read, and the list goes on: no whole minute was seen.
  if (startMs > endMs && instantMs(oldest) <= endMs) return 'none';
  return { windowStart: isoWithOffset(startMs, ctx.offsetAt(startMs)), windowEnd };
}

/** The span the list shows (header), or null when it shows none whole or it cannot be known. */
export function sentWindow(doc: Document, ctx: ExtractContext): VisibleWindow | null {
  const list = sentPageOf(doc);
  if (!list.ok) return null;
  const span = spanOf(list, ctx);
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
  const span = spanOf(list, ctx);
  if (span === null) return null;
  return span === 'none' ? [] : [span];
}
