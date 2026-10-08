/**
 * Muse's health (sprint_3 3.2; agents/adapter_engineer.md rule 2): IDLE on a page it does not read (no conversation,
 * activity view or connected apps: `view.unread`); DEGRADED when a page it reads lacks a landmark its extractor depends
 * on, named `selector.missing.<landmark>` (Hard Rule 6), so a Muse redesign is a failing check, never a silent zero;
 * else OK. Pure over the DOM (Hard Rule 3). Synthetic selectors until the captures (./selectors.ts).
 */
import type { HealthCheck } from '../types';
import { SELECTORS as S } from './selectors';

/** Whether every element under `root` that `selector` matches passes `check` (true when none matches). */
function every(root: Element, selector: string, check: (element: Element) => boolean): boolean {
  return [...root.querySelectorAll(selector)].every(check);
}

/** The landmarks a page Muse reads lacks, each as its reason code. */
function missing(conversation: Element | null, activity: Element | null, settings: Element | null): string[] {
  const reasons: string[] = [];
  if (conversation !== null && (conversation.getAttribute(S.conversationId) ?? '') === '')
    reasons.push('selector.missing.conversation_id');
  if (
    conversation !== null &&
    !every(conversation, S.message, (m) => m.querySelector(S.messageText) !== null)
  )
    reasons.push('selector.missing.message_text');
  if (activity !== null && !every(activity, S.activityEntry, (e) => e.querySelector(S.entrySummary) !== null))
    reasons.push('selector.missing.entry_summary');
  const appIsWhole = (app: Element): boolean =>
    app.querySelector(S.appName) !== null && app.querySelector(S.appSwitch) !== null;
  if (settings !== null && !every(settings, S.app, appIsWhole)) reasons.push('selector.missing.app');
  return reasons;
}

export function museHealth(doc: Document): HealthCheck {
  const conversation = doc.querySelector(S.conversation);
  const activity = doc.querySelector(S.activity);
  const settings = doc.querySelector(S.settings);
  if (conversation === null && activity === null && settings === null) {
    return { status: 'IDLE', reasons: ['view.unread'] };
  }
  const [first, ...rest] = missing(conversation, activity, settings);
  return first === undefined ? { status: 'OK' } : { status: 'DEGRADED', reasons: [first, ...rest] };
}
