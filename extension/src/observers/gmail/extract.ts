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
 * The visible window (docs/grading.md §3) runs from the oldest row's time to the pass instant at the head of the
 * list (`#sent`, `Newer` off), else to the newest row's time. It is null when the page is not the Sent list or any
 * row's time is unknown: an unread row could be the oldest or the newest.
 *
 * Coverage (`sentWindows`; sprint_2 2.7; Hard Rule 5): only the head of the list asserts its window. Any other
 * Sent page posts its rows and no coverage, by design (OK, never DEGRADED). In conversation view Gmail lists a
 * thread once, under its latest message: a send from a later page's span whose thread later got a reply is listed
 * on an earlier page, under the reply's date, so that span is not every send in it. The head lists every thread
 * whose latest message is at or after its oldest row, and a row holding more than one message is refused
 * (./sent-time.ts, so the pass asserts nothing): a send in the head's span is a row on the page.
 */
import { instantMs } from '../../core/normalize';
import { clampSubjectHint } from '../../core/redact';
import { oneLine } from '../text';
import type { ExtractContext, RawRow, VisibleWindow } from '../types';
import { readSentPage, type SentRowParts } from './sent-page';
import { sentAt } from './sent-time';
import { SENT_SELECTORS } from './selectors';

const NO_SUBJECT: ReadonlySet<string> = new Set(SENT_SELECTORS.text.noSubject);

/** The row's subject hint: one line, cut to 80 code points; undefined for an empty or "(no subject)" subject. */
export function subjectHintOf(subject: Element): string | undefined {
  const line = oneLine(subject.textContent);
  return line === '' || NO_SUBJECT.has(line) ? undefined : clampSubjectHint(line);
}

function rawRows(row: SentRowParts, ctx: ExtractContext): RawRow[] {
  const occurredAt = sentAt(row, ctx);
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
  const page = readSentPage(doc);
  return page.ok ? page.rows.flatMap((row) => rawRows(row, ctx)) : [];
}

/** The span the list shows (header), or null when it cannot be known. */
export function sentWindow(doc: Document, ctx: ExtractContext): VisibleWindow | null {
  const page = readSentPage(doc);
  if (!page.ok) return null;
  const times: string[] = [];
  for (const row of page.rows) {
    const at = sentAt(row, ctx);
    if (at === null) return null;
    times.push(at);
  }
  const byInstant = times.sort((a, b) => instantMs(a) - instantMs(b));
  const oldest = byInstant[0];
  const newest = byInstant[byInstant.length - 1];
  if (oldest === undefined || newest === undefined) return null;
  return { windowStart: oldest, windowEnd: page.head ? ctx.observedAt : newest };
}

/**
 * `Observer.visibleWindows`: the head of the Sent list asserts its span; any other Sent page asserts none, by
 * design (header). Null when the page is not the Sent list, or the head's span cannot be known (`window.unknown`).
 */
export function sentWindows(doc: Document, ctx: ExtractContext): VisibleWindow[] | null {
  const page = readSentPage(doc);
  if (!page.ok) return null;
  if (!page.head) return [];
  const span = sentWindow(doc, ctx);
  return span === null ? null : [span];
}
