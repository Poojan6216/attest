/**
 * The person's choices that send something (./privacy-text.ts; Sprint 5 close, security review SEC-1), read by every
 * page: the flags in ledger meta (src/ledger/consent.ts) and the saved key's vendor in `chrome.storage.local`, never
 * the key. Read again when the service worker announces a meta change or the saved vendor changes. Readers only; the
 * service worker writes.
 */
import { browser } from 'wxt/browser';

import { ByoVendorName } from '../bus/page-commands';
import { STORAGE_KEYS } from '../config';
import { type ByoVendor } from '../config-network';
import { readFlags } from '../ledger/consent';
import { getLedger } from '../ledger/shared';
import { onLedgerChanged } from './data';
import type { PrivacyState } from './privacy-text';

/**
 * The vendor of the person's own model key (sprint_5 5.3), or null when no key is saved: the vendor is written only
 * with a key and removed with it (src/background/byo.ts), so a page knows a key is saved without reading it.
 */
export async function loadByoVendor(): Promise<ByoVendor | null> {
  const stored: unknown = (await browser.storage.local.get(STORAGE_KEYS.BYO_VENDOR))[STORAGE_KEYS.BYO_VENDOR];
  const vendor = ByoVendorName.safeParse(stored);
  return vendor.success ? vendor.data : null;
}

/** What leaves the browser now (header): the key's vendor while the key is on and saved, and the usage numbers. */
export async function loadPrivacy(): Promise<PrivacyState> {
  const flags = await readFlags(await getLedger());
  return { byo: flags.ATTEST_MODEL_BYO ? await loadByoVendor() : null, telemetry: flags.ATTEST_TELEMETRY };
}

/** Calls `onChange` when a choice may have changed (header); returns the unsubscribe. */
export function onPrivacyChanged(onChange: () => void): () => void {
  const off = onLedgerChanged(['meta'], onChange);
  const vendorChanged = (changes: Record<string, unknown>): void => {
    if (STORAGE_KEYS.BYO_VENDOR in changes) onChange();
  };
  browser.storage.local.onChanged.addListener(vendorChanged);
  return () => {
    off();
    browser.storage.local.onChanged.removeListener(vendorChanged);
  };
}

/** Where a page reads the choices from. */
export interface PrivacySources {
  readonly load: () => Promise<PrivacyState>;
  readonly subscribe: (onChange: () => void) => () => void;
}

/** The ledger and storage. */
export const LIVE_PRIVACY: PrivacySources = { load: loadPrivacy, subscribe: onPrivacyChanged };
