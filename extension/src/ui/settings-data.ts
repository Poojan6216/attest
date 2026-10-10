/**
 * What the options page reads from the ledger (sprint_4 4.4, 4.5): every agent's grant and whether its alerts are
 * muted, the retention window in force, the person's choices (src/ledger/consent.ts) and each reader's health. Moved
 * out of ./data.ts in the Sprint 4 close (tech review TECH-5), so the popup's start loads none of it. Readers only,
 * through the page's own connection to the ledger (src/ledger/shared.ts); the service worker writes.
 */
import type { ReaderId } from '../config';
import { type Flags, readersOff, readFlags } from '../ledger/consent';
import { readRetentionDays, type RetentionChoice } from '../ledger/settings';
import { getLedger } from '../ledger/shared';
import type { AdapterHealth } from '../ledger/types';
import { grantSettings, type GrantSettings, healthReports } from '../ledger/views';

export type { GrantSettings } from '../ledger/views';
/** The saved key's vendor: read by every page now (./privacy-data.ts), and by the options page's Model section. */
export { loadByoVendor } from './privacy-data';

/** The latest health report of every adapter and observer. */
export async function loadHealth(): Promise<AdapterHealth[]> {
  return healthReports(await getLedger());
}

/** The options page's Grants: every agent's grant, and each agent whose alerts are muted. */
export async function loadGrantSettings(): Promise<GrantSettings> {
  return grantSettings(await getLedger());
}

/** The retention window in force (sprint_4 4.5): what the options page's Privacy shows. */
export async function loadRetentionDays(): Promise<RetentionChoice> {
  return readRetentionDays(await getLedger());
}

/** The person's choices the options page shows (src/ledger/consent.ts): the readers that are off, and the flags. */
export async function loadConsent(): Promise<{ readersOff: ReadonlySet<ReaderId>; flags: Flags }> {
  const db = await getLedger();
  return { readersOff: await readersOff(db), flags: await readFlags(db) };
}
