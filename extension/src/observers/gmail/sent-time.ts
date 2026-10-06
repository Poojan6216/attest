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
 * be a reply the user received. A row's time is a send time only when the row provably holds one message: Gmail's
 * legacy thread id is the id of the conversation's first message, so a row whose thread id, last message id and
 * last non-draft message id are one id holds exactly that message, which is in Sent, so the user sent it.
 *
 * A row whose ids are all there but differ is a conversation of several messages (a reply, a draft on it): the
 * list cannot time the user's sends in it, only that each was at or before the row's own minute. Real Sent lists
 * are mostly such rows (48 of 50 on the first page of the capture of 2026-10-06), so they are not refused: they give
 * no row, and the window starts after the newest one (./extract.ts), so it never holds a send it did not time
 * (Hard Rule 5). A row missing an id cannot be told apart, and is refused (DEGRADED: a markup change is loud).
 */
import { resolveRelative } from '../../core/normalize';
import { oneLine } from '../text';
import type { ExtractContext } from '../types';
import type { SentRowParts } from './sent-page';
import { SENT_SELECTORS } from './selectors';

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

/** True when the row provably holds one message (header): thread id = last message id = last non-draft id. */
export function holdsOneMessage(row: SentRowParts): boolean {
  return row.threadId === row.rowKey && row.lastNonDraftId === row.rowKey;
}

/**
 * What the list says of a row's time (header): the minute of its one send; a conversation of several messages, with
 * its newest message's minute (null when unreadable); or nothing it can read, which refuses the row.
 */
export type RowTime =
  | { readonly kind: 'send'; readonly at: string }
  | { readonly kind: 'conversation'; readonly latest: string | null }
  | { readonly kind: 'unreadable' };

/** The row's time as the list shows it, read at `ctx.observedAt` (header). */
export function rowTime(row: SentRowParts, ctx: ExtractContext): RowTime {
  if (row.threadId === null || row.lastNonDraftId === null) return { kind: 'unreadable' };
  const minute = minuteOf(row.time, ctx);
  if (!holdsOneMessage(row)) return { kind: 'conversation', latest: minute };
  return minute === null ? { kind: 'unreadable' } : { kind: 'send', at: minute };
}
