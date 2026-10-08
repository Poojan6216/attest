/**
 * Gmail Sent health (sprint_2 2.2, 2.11; agents/adapter_engineer.md rule 2; Hard Rules 5, 6). Runs before every
 * extraction: OK only when the Sent list is the view Gmail shows and every landmark the extractor reads is there
 * (./sent-page.ts), and the account switcher names one account (./account.ts). A page that is not a Sent list is
 * IDLE, neither OK nor broken: Drafts, Inbox, a label or a search is `not_sent_folder`, an opened conversation is
 * `not_sent_list`. Nothing is extracted and no coverage is written, so Attest says "Gmail Sent not checked" instead
 * of pretending it looked, and the ledger keeps the status a Sent list gave, so a second tab on another folder never
 * flips it (the live smoke of 2026-10-07). Anything else is DEGRADED with one reason code naming what is missing. It
 * reads the pass's one read of the page (TECH-2).
 */
import { ACCOUNT_REASONS } from '../google-account';
import type { HealthCheck } from '../types';
import { readGmailAccount } from './account';
import { SENT_PAGE_REASONS, sentPageOf } from './sent-page';

/** Every reason Gmail Sent health can give, in a closed list (Hard Rules 2, 10). */
export const SENT_HEALTH_REASONS = Object.freeze([...SENT_PAGE_REASONS, ...ACCOUNT_REASONS] as const);

export type SentHealthReason = (typeof SENT_HEALTH_REASONS)[number];

/** The reasons that say the page is not a Sent list: IDLE, neither OK nor broken (sprint_2 2.11). */
export const SENT_IDLE_REASONS: ReadonlySet<SentHealthReason> = new Set(['not_sent_folder', 'not_sent_list']);

const degraded = (reason: SentHealthReason): HealthCheck => ({ status: 'DEGRADED', reasons: [reason] });

/** `Observer.health` for gmail.sent. */
export function sentHealth(doc: Document): HealthCheck {
  const page = sentPageOf(doc);
  if (!page.ok) {
    return SENT_IDLE_REASONS.has(page.reason)
      ? { status: 'IDLE', reasons: [page.reason] }
      : degraded(page.reason);
  }
  const account = readGmailAccount(doc);
  if (!account.ok) return degraded(account.reason);
  return { status: 'OK' };
}
