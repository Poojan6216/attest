/**
 * Gmail Sent health (sprint_2 2.2; agents/adapter_engineer.md rule 2; Hard Rules 5, 6). Runs before every
 * extraction: OK only when the Sent list is the view Gmail shows and every landmark the extractor reads is there
 * (./sent-page.ts), and the account switcher names one account (./account.ts). Anything else is DEGRADED with one
 * reason code naming what is missing, and nothing is extracted, so Attest says "Gmail Sent not checked" instead of
 * pretending it looked: Drafts, Inbox, a label or a search is `not_sent_folder`, an opened conversation is
 * `not_sent_list`.
 */
import type { HealthCheck } from '../types';
import { readGmailAccount } from './account';
import { readSentPage, SENT_PAGE_REASONS } from './sent-page';

/** Every reason Gmail Sent health can give, in a closed list (Hard Rules 2, 10). */
export const SENT_HEALTH_REASONS = Object.freeze([
  ...SENT_PAGE_REASONS,
  'selector.missing.account',
  'selector.ambiguous.account',
] as const);

export type SentHealthReason = (typeof SENT_HEALTH_REASONS)[number];

const degraded = (reason: SentHealthReason): HealthCheck => ({ status: 'DEGRADED', reasons: [reason] });

/** `Observer.health` for gmail.sent. */
export function sentHealth(doc: Document): HealthCheck {
  const page = readSentPage(doc);
  if (!page.ok) return degraded(page.reason);
  const account = readGmailAccount(doc);
  if (!account.ok) return degraded(account.reason);
  return { status: 'OK' };
}
