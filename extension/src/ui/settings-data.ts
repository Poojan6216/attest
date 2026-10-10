/**
 * What the options page reads from the ledger (sprint_4 4.4, 4.5): every agent's grant and whether its alerts are
 * muted, the retention window in force, the person's choices (src/ledger/consent.ts) and each reader's health. Moved
 * out of ./data.ts in the Sprint 4 close (tech review TECH-5), so the popup's start loads none of it. Readers only,
 * through the page's own connection to the ledger (src/ledger/shared.ts); the service worker writes.
 */
import { browser } from 'wxt/browser';

import { ByoVendorName } from '../bus/page-commands';
import { type ByoVendor, type ReaderId, STORAGE_KEYS } from '../config';
import { type Flags, readersOff, readFlags } from '../ledger/consent';
import { readRetentionDays, type RetentionChoice } from '../ledger/settings';
import { getLedger } from '../ledger/shared';
import type { AdapterHealth } from '../ledger/types';
import { grantSettings, type GrantSettings, healthReports } from '../ledger/views';

export type { GrantSettings } from '../ledger/views';

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

/**
 * The vendor of the person's own model key (sprint_5 5.3), or null when no key is saved: the vendor is written only
 * with a key and removed with it (src/background/byo.ts), so the page knows a key is saved without reading it.
 */
export async function loadByoVendor(): Promise<ByoVendor | null> {
  const stored: unknown = (await browser.storage.local.get(STORAGE_KEYS.BYO_VENDOR))[STORAGE_KEYS.BYO_VENDOR];
  const vendor = ByoVendorName.safeParse(stored);
  return vendor.success ? vendor.data : null;
}

/** The person's choices the options page shows (src/ledger/consent.ts): the readers that are off, and the flags. */
export async function loadConsent(): Promise<{ readersOff: ReadonlySet<ReaderId>; flags: Flags }> {
  const db = await getLedger();
  return { readersOff: await readersOff(db), flags: await readFlags(db) };
}
