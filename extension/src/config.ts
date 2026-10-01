/**
 * Constants for the whole extension. UPPER_SNAKE only.
 *
 * Grading thresholds, windows, weights and allowlists do NOT live here: they live in
 * `policy/default.json` (Hard Rule 4, ledger_engineer rule 2). This file holds hosts,
 * storage keys, alarm names, feature-flag defaults and other plumbing constants.
 */

export const EXTENSION_NAME = 'Attest';

/** IndexedDB database name (Dexie). */
export const DB_NAME = 'attest';

/** Keys in `chrome.storage.local`. Only small flags and the install id live there. */
export const STORAGE_KEYS = {
  INSTALL_ID: 'attest.installId',
  FLAGS: 'attest.flags',
} as const;

/**
 * Hard Rule 1: hosts the extension may contact. Empty: nothing leaves the browser.
 * Sprint 5 adds exactly one telemetry host here, and only when the user opts in.
 */
export const NETWORK_ALLOWLIST: readonly string[] = [];
