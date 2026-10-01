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

/**
 * Width of the time buckets used by the `[type+timeBucket]` ledger index (storage plumbing, not a
 * grading window). Candidate retrieval reads the buckets that overlap its policy window.
 */
export const LEDGER_TIME_BUCKET_MINUTES = 60;

/**
 * Host match patterns for the observer pages (Hard Rule 8: exact domains only, never `<all_urls>`).
 * NOT in the manifest yet: `host_permissions` stays empty until Sprint 2, when each observer's `hosts`
 * (build_spec §7 adapter contract) is read from here.
 */
export const OBSERVER_HOSTS: Readonly<Record<'gmail' | 'gcal', readonly string[]>> = Object.freeze({
  gmail: Object.freeze(['https://mail.google.com/*']),
  gcal: Object.freeze(['https://calendar.google.com/*']),
});

/**
 * Host match patterns for the agent pages (Hard Rule 8). NOT in the manifest yet (Sprint 3 adds them).
 * Dots runs on the ChatGPT host behind the ATTEST_DOTS flag.
 */
export const AGENT_HOSTS: Readonly<Record<'chatgpt' | 'claude' | 'muse', readonly string[]>> = Object.freeze({
  chatgpt: Object.freeze(['https://chatgpt.com/*']),
  claude: Object.freeze(['https://claude.ai/*']),
  // The exact Muse web app host is pending MANUAL.md ("confirm Muse web app host for host_permissions").
  // Never guess a host: until the founder confirms it, Muse gets no host pattern at all.
  muse: Object.freeze([]),
});

/**
 * Feature flags. Every flag defaults to off: Dots support, auto-check Gmail (Hard Rule 11), opt-in
 * telemetry (Hard Rule 1) and the advisory model (Hard Rule 4) are each turned on by the user only.
 * The user's choices are stored under STORAGE_KEYS.FLAGS.
 */
export const FEATURE_FLAGS = Object.freeze([
  'ATTEST_DOTS',
  'ATTEST_AUTO_CHECK_GMAIL',
  'ATTEST_TELEMETRY',
  'ATTEST_MODEL',
] as const);

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlag, boolean>> = Object.freeze({
  ATTEST_DOTS: false,
  ATTEST_AUTO_CHECK_GMAIL: false,
  ATTEST_TELEMETRY: false,
  ATTEST_MODEL: false,
});

/**
 * Service-worker alarm names (extension_engineer: alarm names are constants; duplicates are cleared on
 * install/update). Sprint 0 schedules only the retention purge; Sprint 2.6 implements its body.
 */
export const ALARM_NAMES = Object.freeze({
  PURGE: 'attest.purge',
} as const);

export type AlarmName = (typeof ALARM_NAMES)[keyof typeof ALARM_NAMES];

/** How often the retention purge alarm fires (once a day). */
export const PURGE_ALARM_PERIOD_MINUTES = 24 * 60;
