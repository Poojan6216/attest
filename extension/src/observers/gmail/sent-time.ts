/**
 * When a Sent row was sent (sprint_2 2.2; agents/adapter_engineer.md rule 7; docs/grading.md §11; Hard Rule 5).
 *
 * The time element's `title` is the absolute time ("Sat, Oct 3, 2026, 9:41 AM"); its `aria-label` and text are
 * relative ("9:41 AM" today, "Yesterday, 11:47 PM", "Oct 2" before). Each is resolved with
 * `normalize.resolveRelative` against the pass instant in the browser's zone (`ctx.offsetAt`), so a DST change, a
 * midnight row and "Yesterday" read at 00:30 resolve in the offset of their own instant. The first of title, label,
 * text that reads as a time at all decides; a later one is used only when an earlier one is absent or unreadable.
 * Only a minute is a send time: a text that names only a day ("Oct 1"), or a clock time a DST change makes
 * ambiguous or skipped (which resolves to the day), gives no time, and the row is refused rather than guessed.
 *
 * Conversation view: a list row stands for a whole conversation, and its time is the newest message's, which can
 * be a reply the user received. A row's time is a send time only when what the list shows says the row holds one
 * message, which is in Sent, so the user sent it (`holdsOneMessage`). Its last message is its last non-draft one,
 * and Gmail shows no message count after its recipients: it draws one for every conversation of two messages or more.
 * Then either Gmail's legacy thread id (the id of the conversation's first message) is that id too, or the list
 * draws counts at all, so the missing count says one message: a mail composed as a draft first keeps the draft's
 * older id as its thread id (live smoke of 2026-10-07, gmail.sent 1.3.0). A list that draws no count anywhere is
 * read by its ids alone, as before: one page cannot tell a list of single messages from counts Gmail stopped drawing.
 *
 * Any other row whose ids are all there is a conversation of several messages (a reply, a draft on it): the list
 * cannot time the user's sends in it, only that each was at or before the row's own minute. Real Sent lists hold many
 * such rows (40 of 50 on the first page of the capture of 2026-10-06), so they are not refused: they give no row, and
 * the window starts after the newest one (./extract.ts), so it never holds a send it did not time (Hard Rule 5). A
 * row missing an id, or with one not in Gmail's legacy form (selectors.json `patterns.legacyId`: an empty or
 * prefixed id included), cannot be told apart, and is refused (DEGRADED: a change of the ids' markup or form is loud;
 * tech re-review TECH-R3). A change in what the ids mean that keeps their form, or in where Gmail draws the count,
 * would make rows conversations, which one page cannot tell from a real list of conversations: a known limit, for
 * Sprint 6.4's count of rows given no row.
 */
import { resolveRelative } from '../../core/normalize';
import { oneLine } from '../text';
import type { ExtractContext } from '../types';
import type { SentRowParts } from './sent-page';
import { LEGACY_ID, SENT_SELECTORS } from './selectors';

/** The texts a time element carries, most absolute first: its time attributes, then its own text. */
function timeTexts(element: Element): string[] {
  const attributes = SENT_SELECTORS.attributes.time.map((name) => element.getAttribute(name));
  return [...attributes, element.textContent].flatMap((text) => {
    const line = oneLine(text ?? '');
    return line === '' ? [] : [line];
  });
}

/** The start of the minute `element` names (ISO 8601 with offset), read at `ctx.observedAt`, or null. */
export function minuteOf(element: Element, ctx: ExtractContext): string | null {
  for (const text of timeTexts(element)) {
    const time = resolveRelative(text, { referenceIso: ctx.observedAt, offsetAt: ctx.offsetAt });
    if (time === null) continue;
    return time.precision === 'minute' ? time.start : null;
  }
  return null;
}

/**
 * True when the row holds one message (header): its last message is its last non-draft one, it shows no message
 * count, and either its thread id is that id too, or the list draws counts (`countsShown`: some row of it shows one).
 * A mail composed as a draft first is the second: its thread keeps the draft's older id (the live smoke of 2026-10-07;
 * 51 rows of the 158 on the real Sent pages of 2026-10-06 have an older thread id and no count, each read as a
 * conversation before). A count beside a row whose ids are one id contradicts them: not timed (Hard Rule 5).
 */
export function holdsOneMessage(row: SentRowParts, countsShown: boolean): boolean {
  if (row.lastNonDraftId !== row.rowKey || row.messageCount !== null) return false;
  return row.threadId === row.rowKey || countsShown;
}

/**
 * What the list says of a row's time (header): the minute of its one send; a conversation of several messages, with
 * its newest message's minute (null when unreadable); or nothing it can read, which refuses the row.
 */
export type RowTime =
  | { readonly kind: 'send'; readonly at: string }
  | { readonly kind: 'conversation'; readonly latest: string | null }
  | { readonly kind: 'unreadable' };

/** An id in Gmail's legacy form (never null or empty). */
const legacyId = (id: string | null): boolean => id !== null && LEGACY_ID.test(id);

/** The row's time as the list shows it, read at `ctx.observedAt` (header); `countsShown` as `holdsOneMessage` reads it. */
export function rowTime(row: SentRowParts, ctx: ExtractContext, countsShown: boolean): RowTime {
  if (!legacyId(row.threadId) || !legacyId(row.lastNonDraftId) || !legacyId(row.rowKey))
    return { kind: 'unreadable' };
  const minute = minuteOf(row.time, ctx);
  if (!holdsOneMessage(row, countsShown)) return { kind: 'conversation', latest: minute };
  return minute === null ? { kind: 'unreadable' } : { kind: 'send', at: minute };
}
