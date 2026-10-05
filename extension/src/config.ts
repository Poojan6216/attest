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
 * They are the manifest's `host_permissions` (wxt.config.ts, Sprint 2.0) and each observer's `hosts` (build_spec §7
 * adapter contract; src/observers/base.ts assertObserver refuses any other).
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

/**
 * The observer skeleton's pass scheduling (sprint_2 2.0, src/observers/batch.ts). A burst of DOM mutations on a
 * Gmail or Calendar page runs one pass OBSERVER_DEBOUNCE_MS after the last mutation, and never later than
 * OBSERVER_MAX_WAIT_MS after the first one, so a page that never stops changing is still read.
 */
export const OBSERVER_DEBOUNCE_MS = 500;
export const OBSERVER_MAX_WAIT_MS = 2_000;

/**
 * A coverage ping's `userActive` (src/observers/activity.ts): the tab is visible and the user pressed a key,
 * pointed, scrolled or touched in it within the last USER_ACTIVE_WINDOW_MS. Input is noted at most once per
 * USER_ACTIVITY_THROTTLE_MS, and only its instant is kept, never the key or the target. `false` is not idle
 * evidence on its own (docs/grading.md §7: userIdle needs positive evidence; Sprint 3.5 records idle intervals).
 */
export const USER_ACTIVE_WINDOW_MS = 60_000;
export const USER_ACTIVITY_THROTTLE_MS = 1_000;

/**
 * When a page can vouch that it shows the present (src/observers/lifecycle.ts `trackPageSync`; Decisions [2.close]
 * S4, QA-V2; Hard Rule 5). No pass posts coverage while the page reports itself offline. After it comes back (online
 * again, resumed from frozen, shown again after PAGE_RESYNC_HIDDEN_MS hidden, or its own tick, every PAGE_TICK_MS,
 * finds a gap of PAGE_SLEEP_GAP_MS: the machine slept), each observer's first pass, and every pass within
 * PAGE_RESYNC_MS, posts no coverage either. PAGE_RESYNC_HIDDEN_MS is when Chrome starts waking a hidden page's timers
 * only once a minute (the page's own sync runs on them); PAGE_SLEEP_GAP_MS is three such minutes, so a throttled tab
 * never looks asleep.
 */
export const PAGE_RESYNC_MS = 30_000;
export const PAGE_RESYNC_HIDDEN_MS = 5 * 60_000;
export const PAGE_SLEEP_GAP_MS = 3 * 60_000;
export const PAGE_TICK_MS = 30_000;

/** How long dated history is kept: the retention purge (src/ledger/retention.ts, Decisions [2.6]; Hard Rule 2). */
export const RETENTION_DAYS = 90;

/**
 * How far one purge may move past the purge before it when the ledger stored nothing newer (src/ledger/
 * retention-clock.ts, SEC-5): the purge trusts the wall clock only up to the latest instant the ledger stored, or the
 * last purge's instant plus this, so a clock that jumped far ahead deletes no current history, while a ledger left
 * idle still catches up (one day faster than real time per daily run). Also how far ahead of that the clock must be
 * before the purge logs `ledger.purge_clock_ahead`.
 */
export const PURGE_CATCH_UP_DAYS = 2;

/**
 * The observers the service worker accepts messages from, each with the one ObservationSource it reads (sprint_2
 * 2.7; Decisions [2.0]: one observer, one source, one coverage stream). A message naming any other observer, or a
 * row or ping of another source, is refused (`invalid_input`) and nothing of it is stored (Hard Rules 2, 6).
 */
export const OBSERVER_SOURCES = Object.freeze({
  'gmail.sent': 'gmail.sent',
  'gmail.receipt': 'gmail.receipt',
  'gcal.event': 'gcal.event',
} as const);

export type ObserverId = keyof typeof OBSERVER_SOURCES;

/**
 * The site whose content script speaks for each observer (SEC-V1, SEC-4): the service worker accepts an observer's
 * health, rows, pings and snapshots only from a sender whose page is on one of `OBSERVER_HOSTS[site]`, so a Gmail
 * tab can never write Calendar facts or health, nor a Calendar tab Gmail's (src/background/sender-site.ts).
 */
export const OBSERVER_SITES: Readonly<Record<ObserverId, keyof typeof OBSERVER_HOSTS>> = Object.freeze({
  'gmail.sent': 'gmail',
  'gmail.receipt': 'gmail',
  'gcal.event': 'gcal',
});

/**
 * An observer's own health report that says what the stored one says (status, reasons, version) is written only once
 * the stored one is this old (src/ledger/health.ts, TECH-2): a pass runs every few seconds on a busy page, and the
 * stored `checkedAt` stays at most this old while the observer keeps reporting. A change is written at once.
 */
export const OBSERVER_HEALTH_REFRESH_MS = 60_000;

/**
 * How long the service worker holds a Calendar pass's coverage pings while it waits for the pass's
 * `calendar.snapshot` (src/background/observer-state.ts). A pass posts both within a few milliseconds; a held ping
 * older than this was never followed by its snapshot, so its window is never recorded (Hard Rule 5).
 */
export const CALENDAR_PASS_HOLD_MS = 5 * 60_000;

/**
 * When Chrome dropped the purge alarm across a restart, `runtime.onStartup` recreates it to fire this many minutes
 * after start, not a whole period later, so a browser restarted every day still purges (Decisions [2.7]).
 */
export const PURGE_STARTUP_DELAY_MINUTES = 1;

/**
 * How often a visible Calendar tab is read again when nothing on it changed (src/observers/base.ts `heartbeatMs`).
 * The service worker blames a Calendar change only when it compared it with a snapshot read at most
 * `staleChangeMs(policy)` before (2 minutes in the shipped policy; docs/grading.md §3, §7): a change compared with an
 * older snapshot could have been made at any time since, so it is stored as a first sighting and never UNASKED. A quiet
 * tab is otherwise read only when its DOM changes, so its snapshot ages and almost no change could be attributed. A
 * read once a minute while the tab is visible keeps the snapshot inside that bound (since v1.12 no Calendar change is
 * UNASKED until the live smoke, sprint_2 2.8; the bound is kept for when one can be). Hard Rule 11: the beat reads only
 * a tab the user has open and visible. Any open tab, hidden or not, is still read when its page changes, and a hidden
 * tab is read again when it becomes visible, never on a beat.
 */
export const OBSERVER_HEARTBEAT_MS = 60_000;
