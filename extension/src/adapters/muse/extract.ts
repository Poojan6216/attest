/**
 * Reads a Muse page (sprint_3 3.2): the conversation's turns, the activity view's entries, the connected apps. Pure
 * over the DOM (Hard Rule 3): it reads what is rendered and nothing more (no "show more", no expanding an entry), and
 * hands the skeleton (../base.ts) one `AgentRead`, whose text never leaves the content script whole (../claims.ts).
 *
 *  - A turn is a message's own text element only: a preview, card or attachment beside it (an email body Muse quotes,
 *    an approval card's address and card number) is never read. Its time is its `<time>`'s `datetime` when the page
 *    gives one, else the text the page shows ("1:40 PM", "Yesterday"), resolved by the skeleton.
 *  - An activity entry is its summary text and its time, read the same way.
 *  - A scope is the name of an app whose switch is on (`aria-checked="true"`); an app switched off is not one.
 * Synthetic selectors until the captures (./selectors.ts).
 */
import { oneLine } from '../../observers/text';
import type { ActivityEntry, AgentRead, AgentTurn } from '../types';
import { SELECTORS as S } from './selectors';

/** The `<time>` of a message or an entry: its `datetime`, else its text; null when it has none. */
function timeOf(element: Element): string | null {
  const time = element.querySelector(S.time);
  if (time === null) return null;
  const stamp = time.getAttribute('datetime') ?? oneLine(time.textContent);
  return stamp === '' ? null : stamp;
}

function turnOf(message: Element): AgentTurn {
  const key = message.getAttribute(S.messageKey);
  return {
    role: message.getAttribute(S.author) === S.userAuthor ? 'user' : 'agent',
    text: message.querySelector(S.messageText)?.textContent ?? '',
    time: timeOf(message),
    ...(key === null || key === '' ? {} : { rowKey: key }),
  };
}

function entryOf(entry: Element): ActivityEntry {
  return { text: entry.querySelector(S.entrySummary)?.textContent ?? '', time: timeOf(entry) };
}

/** The names of the apps whose switch is on, in page order; null on a page without the connected-apps list. */
function scopesOf(settings: Element | null): string[] | null {
  if (settings === null) return null;
  return [...settings.querySelectorAll(S.app)]
    .filter((app) => app.querySelector(S.appSwitch)?.getAttribute('aria-checked') === 'true')
    .map((app) => oneLine(app.querySelector(S.appName)?.textContent ?? ''));
}

export function museExtract(doc: Document): AgentRead {
  const conversation = doc.querySelector(S.conversation);
  const conversationId = conversation?.getAttribute(S.conversationId) ?? '';
  return {
    conversationId: conversationId === '' ? null : conversationId,
    turns: conversation === null ? [] : [...conversation.querySelectorAll(S.message)].map(turnOf),
    activity: [...(doc.querySelector(S.activity)?.querySelectorAll(S.activityEntry) ?? [])].map(entryOf),
    scopes: scopesOf(doc.querySelector(S.settings)),
  };
}
