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
 * last non-draft message id are one id holds exactly that message, which is in Sent, so the user sent it. Any other
 * row (a reply in the thread, a draft on it, an id missing) cannot be timed from the list, and is refused: no row
 * beats a send recorded at a reply's time (Hard Rule 5).
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

/** The instant the row's one message was sent, or null when the list cannot say (header). */
export function sentAt(row: SentRowParts, ctx: ExtractContext): string | null {
  return holdsOneMessage(row) ? minuteOf(row.time, ctx) : null;
}
