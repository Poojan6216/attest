/**
 * Constants for the whole extension. UPPER_SNAKE only.
 *
 * Grading thresholds, windows, weights and allowlists do NOT live here: they live in
 * `policy/default.json` (Hard Rule 4, ledger_engineer rule 2). This file holds hosts,
 * storage keys, alarm names, feature-flag defaults and other plumbing constants.
 */

export const EXTENSION_NAME = 'Attest';

export const DB_NAME = 'attest'; // The ledger's IndexedDB database (Dexie), in its storage bucket: src/ledger/place.ts.

/** Keys in `chrome.storage.local`. Only small flags, the install id and bucket names live there. */
export const STORAGE_KEYS = {
  INSTALL_ID: 'attest.installId',
  FLAGS: 'attest.flags',
  /** The page readers the person turned off (sprint_4 4.5; src/background/readers.ts). */
  READERS_OFF: 'attest.readersOff',
  /**
   * The person's own model key and its vendor (sprint_5 5.3; src/background/byo.ts), apart: the options page reads the
   * vendor, written only with a key and removed with it, and never the key. Only the extension's own pages and service
   * worker can read this area (`setAccessLevel` TRUSTED_CONTEXTS), never a content script; nothing logs or exports it.
   */
  BYO_VENDOR: 'attest.byoVendor',
  BYO_KEY: 'attest.byoKey',
  LEDGER_BUCKET: 'attest.ledgerBucket', // The storage bucket the ledger is in (Sprint 6 close; src/ledger/place.ts).
} as const;

/**
 * Keys in `chrome.storage.session`, which Chrome empties when the browser closes. `IDLE_SESSION`: true once this
 * browser session started watching for times away, so a time away an earlier session left open is closed as it
 * stands, never stretched over the next day (src/background/idle.ts; security review SEC-1).
 */
export const SESSION_KEYS = {
  IDLE_SESSION: 'attest.idleSession',
  /** The receipt a clicked alert asks the side panel to open (sprint_4 4.6; src/background/alerts.ts). */
  OPEN_RECEIPT: 'attest.openReceipt',
  /** The ledger's keys while it is unlocked, in memory only (sprint_6 6.5; src/crypto/session.ts). */
  LEDGER_KEYS: 'attest.ledgerKeys',
  LEDGER_REBUILD: 'attest.ledgerRebuild', // While the ledger is rebuilt (Sprint 6 close; src/ledger/rebuild-mark.ts).
} as const;

/**
 * The extractor id of every claim read from a log `agent`'s person pasted (sprint_3 3.11): the parser writes it
 * (src/adapters/paste.ts) and `claims.import` holds every claim to it (src/bus/messages.ts).
 */
export const importExtractorId = (agent: string): string => `import.${agent}`;

export * from './config-network';

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
 * The page readers a person can turn off in the options page (sprint_4 4.5): one per site of `OBSERVER_HOSTS`, each
 * the content script of that name (entrypoints/content/<reader>.content.ts), registered while it is on.
 */
export const READERS = Object.freeze([
  'gmail',
  'gcal',
] as const satisfies readonly (keyof typeof OBSERVER_HOSTS)[]);

export type ReaderId = (typeof READERS)[number];

/**
 * Host match patterns for the agent pages (Hard Rule 8). A host enters the manifest's `host_permissions` only with the
 * content script that reads it, and only while its reader is on (AGENT_READERS): none is today (wxt.config.ts;
 * Decisions [3.0], [3.10]). Dots runs on the ChatGPT host behind the ATTEST_DOTS flag.
 */
export const AGENT_HOSTS: Readonly<Record<'chatgpt' | 'claude' | 'muse', readonly string[]>> = Object.freeze({
  chatgpt: Object.freeze(['https://chatgpt.com/*']),
  claude: Object.freeze(['https://claude.ai/*']),
  // Confirmed by the founder on 2026-10-08 (MANUAL.md): the address of Muse's web app.
  muse: Object.freeze(['https://muse.ai/*']),
});

/**
 * Whether each agent's reader runs (sprint_3 3.10): off, all three. Meta's, OpenAI's and Anthropic's terms forbid
 * collecting data from their sites by automated means, and the founder chose to keep the readers off, with a note in
 * the options page (2026-10-08; the clauses are in Decisions [3.10]). So no agent host is in the manifest and no agent
 * content script ships; a reader turns on only with its vendor's written permission (Hard Rule 8).
 */
export type ReaderState = 'on' | 'off';

export const AGENT_READERS: Readonly<Record<keyof typeof AGENT_HOSTS, ReaderState>> = Object.freeze({
  muse: 'off',
  chatgpt: 'off',
  claude: 'off',
});

/**
 * Feature flags. Every flag defaults to off: Dots support, auto-check Gmail (Hard Rule 11), opt-in
 * telemetry (Hard Rule 1) and the advisory model (Hard Rule 4) are each turned on by the user only.
 * The user's choices are kept in ledger meta (src/ledger/consent.ts; sprint_4 close, security review SEC-3).
 */
export const FEATURE_FLAGS = Object.freeze([
  'ATTEST_DOTS',
  'ATTEST_AUTO_CHECK_GMAIL',
  'ATTEST_TELEMETRY',
  'ATTEST_MODEL',
  'ATTEST_MODEL_BYO',
] as const);

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlag, boolean>> = Object.freeze({
  ATTEST_DOTS: false,
  ATTEST_AUTO_CHECK_GMAIL: false,
  ATTEST_TELEMETRY: false,
  ATTEST_MODEL: false,
  ATTEST_MODEL_BYO: false,
});

/**
 * The flags a person turns on or off in the options page: the Gmail auto-check (sprint_4 4.9), Chrome's on-device
 * model (sprint_5 5.2), their own model key (5.3) and the opt-in telemetry (5.7). Each other flag comes with its
 * feature.
 */
export const SETTABLE_FLAGS = Object.freeze([
  'ATTEST_AUTO_CHECK_GMAIL',
  'ATTEST_MODEL',
  'ATTEST_MODEL_BYO',
  'ATTEST_TELEMETRY',
] as const satisfies readonly FeatureFlag[]);

export type SettableFlag = (typeof SETTABLE_FLAGS)[number];

/**
 * The advisory model's time for one claim (sprint_5 5.1; agents/intel_engineer.md rule 4): an answer later than this
 * is no answer, and the claim is graded rules-only.
 */
export const INTEL_TIMEOUT_MS = 2_000;

/**
 * How many claims the service worker asks the advisory model about in one run after a batch (sprint_5 5.4,
 * src/background/intel.ts), one at a time: at most 20 seconds of calls, inside the half minute an idle service worker
 * is kept. Those left are asked after the next batch: the grace alarm runs one every GRADE_ALARM_PERIOD_MINUTES.
 */
export const MODEL_ASKS_PER_RUN = 10;

/** The model providers: Chrome's on-device model and the person's own key (sprint_5 5.2, 5.3; one list, TECH-7). */
export const MODEL_PROVIDERS = Object.freeze(['builtin', 'byo'] as const);

/** What a telemetry send did (src/telemetry/send.ts; the `telemetry.send` answer's words; one list, TECH-7). */
export const TELEMETRY_OUTCOMES = Object.freeze([
  'off',
  'already_sent',
  'not_built',
  'sent',
  'failed',
] as const);

/**
 * What the Gmail auto-check opens (sprint_4 4.9; src/background/auto-check.ts): the Sent folder of the first account
 * signed in, which the Gmail reader's Sent observer reads. One of OBSERVER_HOSTS.gmail.
 */
export const AUTO_CHECK_URL = 'https://mail.google.com/mail/u/0/#sent';

/**
 * Service-worker alarm names (extension_engineer: alarm names are constants; duplicates are cleared on
 * install/update): the retention purge (Sprint 2.6), the grace alarm that runs a grading batch (sprint_3 3.13), the
 * weekly digest (sprint_4 4.7) and the opt-in telemetry's daily send (sprint_5 5.7).
 */
export const ALARM_NAMES = Object.freeze({
  PURGE: 'attest.purge',
  GRADE: 'attest.grade',
  DIGEST: 'attest.digest',
  TELEMETRY: 'attest.telemetry',
} as const);

/**
 * How often the opt-in telemetry's alarm looks for a day to send (sprint_5 5.7; src/background/telemetry.ts): each
 * hour, so a day is sent soon after it ends even when Chrome was closed at midnight; each day at most once.
 */
export const TELEMETRY_ALARM_PERIOD_MINUTES = 60;

/**
 * How soon a recreated telemetry alarm first fires after a browser start: two minutes, after the one-minute catch-ups
 * (the grace batch among them) have run, so the first send counts yesterday's receipts as the catch-up settled them.
 */
export const TELEMETRY_STARTUP_DELAY_MINUTES = 2;

/**
 * How long the telemetry POST may take (Sprint 5 close, tech review TECH-13): a server that does not answer gives a
 * failed send, tried again at the next alarm, never a call left hanging in the service worker.
 */
export const TELEMETRY_TIMEOUT_MS = 10_000;

/**
 * When the weekly digest is made (sprint_4 4.7; src/background/digest.ts): Monday (`Date.getDay()` 1) at 09:00 on the
 * browser's clock, for the week that ended at the Monday's midnight. A one-shot alarm, set again each time it fires, so
 * a change to or from daylight saving time never moves it off 09:00.
 */
export const DIGEST_WEEKDAY = 1;
export const DIGEST_HOUR = 9;

/** The notification that says a weekly digest is ready (sprint_4 4.7); a click opens it. */
export const DIGEST_NOTIFICATION_ID = 'attest.digest';

/**
 * Alerts (sprint_4 4.6; sprint_4 close, tech review TECH-12): one delivery settles at most ALERTS_PER_TAKE pending
 * alerts, the rest at the next (a grading batch, or the next grace alarm). When more than ALERT_BURST are to be shown at
 * once (a pasted log whose claims were all past their grace, say), one notice says how many receipts need a look, and a
 * click opens the timeline (ALERTS_NOTIFICATION_ID), instead of a notification each.
 */
export const ALERTS_PER_TAKE = 100;
export const ALERT_BURST = 3;
export const ALERTS_NOTIFICATION_ID = 'attest.alerts';

export type AlarmName = (typeof ALARM_NAMES)[keyof typeof ALARM_NAMES];

/** How often the retention purge alarm fires (once a day). */
export const PURGE_ALARM_PERIOD_MINUTES = 24 * 60;

/**
 * How often the grace alarm runs a grading batch (sprint_3 3.13; docs/grading.md §3): a PENDING receipt is finalised
 * at most this long after its grace has elapsed, whether or not the service worker was stopped meanwhile.
 */
export const GRADE_ALARM_PERIOD_MINUTES = 5;

/** How soon a recreated grace alarm first fires after a browser start. */
export const GRADE_STARTUP_DELAY_MINUTES = 1;

/**
 * Away detection, opt-in (sprint_3 3.14; src/background/idle.ts): Chrome says the person is away after this many
 * seconds without input. An interval starts this long before Chrome says so (the last instant input could have been),
 * so it is positive evidence only (docs/grading.md §7 `userIdle`). Chrome's own minimum is 15.
 */
export const IDLE_DETECTION_SECONDS = 60;

/** The optional permission away detection asks for when the person turns it on (Hard Rule 8). */
export const IDLE_PERMISSION = 'idle' as const;

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
 * The retention windows a person may choose in the options page (sprint_4 4.5), in days; `RETENTION_DAYS` until they
 * choose. Stored in ledger meta (src/ledger/settings.ts), read by the daily purge.
 */
export const RETENTION_CHOICES = Object.freeze([30, 90, 180] as const);

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
 * The agent adapters the service worker accepts health from, each with the site whose content script speaks for it
 * (sprint_3 3.2; as OBSERVER_SITES): an adapter's report is taken only from a page on `AGENT_HOSTS[site]`
 * (src/background/sender-site.ts). No content script runs one while its reader is off (AGENT_READERS).
 */
export const ADAPTER_SITES = Object.freeze({
  'muse.chat': 'muse',
} as const satisfies Record<string, keyof typeof AGENT_HOSTS>);

export type AdapterId = keyof typeof ADAPTER_SITES;

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
 * UNASKED until the account's own changes can be told, sprint_6 6.4; the bound is kept for when one can be). Hard Rule 11: the beat reads only
 * a tab the user has open and visible. Any open tab, hidden or not, is still read when its page changes, and a hidden
 * tab is read again when it becomes visible, never on a beat.
 */
export const OBSERVER_HEARTBEAT_MS = 60_000;

/**
 * The receipts the popup lists: the newest graded since local midnight (sprint_4 4.0, 4.2). The side panel's timeline
 * shows the rest, a page at a time.
 */
export const POPUP_RECEIPT_LIMIT = 50;

/** The receipts one page of the side panel's timeline reads (sprint_4 4.0, 4.3). */
export const TIMELINE_PAGE_SIZE = 50;

/** The local days a new side-panel timeline shows, today included (sprint_4 4.3; moved here in the Sprint 4 close). */
export const TIMELINE_DEFAULT_DAYS = 30;

/**
 * Rows per read when the options page builds an export file (sprint_4 4.5; src/ledger/export-file.ts): each table is
 * read this many keys at a time, never whole, and each page is written into the file before the next is read.
 */
export const EXPORT_PAGE_SIZE = 500;

/**
 * How recent an observer's last check must be for the coverage header to say "checked" rather than "not checked since"
 * (sprint_4 4.1; agents/ux_engineer.md rule 2). An open Gmail or Calendar tab reports at least every 5 minutes even
 * hidden (PAGE_RESYNC_HIDDEN_MS), so a check older than this means the tab was closed or asleep.
 */
export const COVERAGE_FRESH_MINUTES = 10;

/**
 * Where the degraded banner's "Report on GitHub" link opens a new issue (agents/ux_engineer.md rule 3): the project's
 * own repository (build_spec §5). The link carries the adapter's id and version and the Chrome major version only,
 * and nothing is sent unless the person follows it.
 */
export const ISSUES_URL = 'https://github.com/Poojan6216/attest/issues/new';

/**
 * The privacy architecture document on the project's repository (agents/ux_engineer.md rule 8: the options page's
 * first line links to it; sprint_4 4.5). Opened by the person's click, in a new tab; nothing is sent.
 */
export const PRIVACY_DOC_URL = 'https://github.com/Poojan6216/attest/blob/main/docs/privacy-architecture.md';
