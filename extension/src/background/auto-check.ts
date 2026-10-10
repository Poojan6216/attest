/**
 * Auto-check Gmail (sprint_4 4.9; docs/privacy-architecture.md "Auto-check Gmail"): the one exception to Hard Rule 11,
 * off unless the person turns it on in the options page (flag ATTEST_AUTO_CHECK_GMAIL, ./flags.ts).
 *
 * After each grace batch (./alarms.ts), when the flag is on and the Gmail reader is on (./readers.ts), a claim is due
 * when it is an `email.sent` claim whose receipt has been PENDING, with no mark of the person's, for half its grace
 * (`graceMin` / 2) since Attest read it, and no Gmail Sent list has been read since Attest read it: no Gmail tab showed
 * Attest the Sent folder since. Then Attest opens AUTO_CHECK_URL, the Sent folder, in one new tab, pinned and active
 * in the window the person is using, never in the background; the Gmail reader reads it there as in any Gmail tab the
 * person opens, and never acts on the page (Hard Rule 3). No tab opens while Chrome's last focused window does not have
 * the focus (another app is in front, the screen is locked) or is minimised, nor, when away detection is on, while
 * Chrome says the person is idle or locked (sprint_4 close, security review SEC-2): the next batch tries again.
 *
 * Once per grace window: after an open, none follows for `graceMin`, and a claim that was due at an open is never due
 * again, so each claim opens at most one tab. A tab opened before the batch's clock means the clock went back: that
 * record holds nothing back. Each open is recorded in the ledger (src/ledger/auto-check.ts) after the tab is created,
 * so the popup never says a tab opened that did not; the popup says why it opened until its window ends.
 *
 * `chrome.tabs.create` with a URL, and `chrome.windows.getLastFocused`, need no permission: the manifest has no `tabs`
 * (Decisions [4.9]; tests/e2e/auto-check.spec.ts runs it on the built extension).
 */
import { browser } from 'wxt/browser';

import type { LedgerTable } from '../bus/messages';
import { isoWithLocalOffset } from '../clock';
import { AUTO_CHECK_URL, IDLE_DETECTION_SECONDS, IDLE_PERMISSION } from '../config';
import { instantMs } from '../core/normalize';
import { DEFAULT_POLICY, type Policy } from '../core/policy';
import { IsoTs } from '../core/schema';
import { MS_PER_MINUTE } from '../core/units';
import {
  autoCheckInputs,
  type AutoCheckInputs,
  autoCheckWaitMs,
  type CheckingEmailClaim,
  recordAutoCheck,
} from '../ledger/auto-check';
import type { LedgerDb } from '../ledger/db';
import { readersOff, readFlags } from '../ledger/consent';
import { getLedger } from '../ledger/shared';
import { log } from '../log';

export { autoCheckWaitMs } from '../ledger/auto-check';

/** The claims an auto-check at `nowMs` opens Gmail for (header). Pure. */
export function claimsDue(inputs: AutoCheckInputs, nowMs: number, policy: Policy): CheckingEmailClaim[] {
  const { last, gmailSyncMs } = inputs;
  // The last open, unless it is later than now: then the clock went back, and it holds nothing back.
  const lastMs = last === null || instantMs(last.at) > nowMs ? null : instantMs(last.at);
  if (last !== null && lastMs !== null && nowMs < instantMs(last.until)) return [];
  const waitMs = autoCheckWaitMs(policy);
  return inputs.claims.filter(({ observedMs }) => {
    const dueMs = observedMs + waitMs;
    const unseen = gmailSyncMs === null || gmailSyncMs < observedMs;
    return dueMs <= nowMs && unseen && (lastMs === null || dueMs > lastMs);
  });
}

/** The part of Chrome the auto-check uses. */
export interface AutoCheckBrowser {
  /** The window a tab would be seen in now, or null when there is none (header). */
  readonly visibleWindow: () => Promise<number | null>;
  /** Opens `url` in a new pinned tab, active in window `windowId`. */
  readonly openPinned: (windowId: number, url: string) => Promise<void>;
}

/** What Chrome says of its windows and of the person. */
export interface WindowApi {
  readonly lastFocused: () => Promise<{
    readonly id?: number | undefined;
    readonly focused: boolean;
    readonly state?: string | undefined;
  }>;
  /** Chrome's idle state while away detection's permission is held; undefined when Attest cannot know. */
  readonly idleState: () => Promise<string | undefined>;
}

/**
 * The window a tab opened now would be seen in (header): Chrome's last focused normal window, while it has the focus and
 * is not minimised, and, when Chrome can say, while the person is active; else null. A failure to ask is logged.
 */
export async function visibleWindowOf(api: WindowApi): Promise<number | null> {
  try {
    const window = await api.lastFocused();
    if (window.id === undefined || !window.focused || window.state === 'minimized') return null;
    const idle = await api.idleState();
    return idle === undefined || idle === 'active' ? window.id : null;
  } catch (error) {
    log.warn('autocheck.window_failed', { error });
    return null;
  }
}

/** Chrome's own windows and, while its optional permission is held, its idle state. */
export const BROWSER_WINDOWS: WindowApi = {
  lastFocused: () => browser.windows.getLastFocused({ windowTypes: ['normal'] }),
  idleState: async () =>
    (await browser.permissions.contains({ permissions: [IDLE_PERMISSION] }))
      ? browser.idle.queryState(IDLE_DETECTION_SECONDS)
      : undefined,
};

/** Chrome's own. */
export const BROWSER_AUTO_CHECK: AutoCheckBrowser = {
  visibleWindow: () => visibleWindowOf(BROWSER_WINDOWS),
  openPinned: async (windowId, url) => {
    await browser.tabs.create({ windowId, url, pinned: true, active: true });
  },
};

export interface AutoCheckDeps {
  /** The ledger: the claims and coverage, the last open, and the person's choices (src/ledger/consent.ts). */
  readonly db: () => Promise<LedgerDb>;
  readonly policy: Policy;
  readonly nowMs: () => number;
  readonly browser: AutoCheckBrowser;
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

/** The service worker's: the shared ledger, `chrome.storage.local`, the shipped policy, the wall clock and Chrome. */
export function browserAutoCheck(notify: (tables: readonly LedgerTable[]) => void): AutoCheckDeps {
  return {
    db: getLedger,
    policy: DEFAULT_POLICY,
    nowMs: () => Date.now(),
    browser: BROWSER_AUTO_CHECK,
    notify,
  };
}

/** One auto-check (header); resolves how many claims it opened Gmail for, 0 when it opened nothing. */
async function checkOnce(deps: AutoCheckDeps): Promise<number> {
  const db = await deps.db();
  if (!(await readFlags(db)).ATTEST_AUTO_CHECK_GMAIL) return 0;
  if ((await readersOff(db)).has('gmail')) return 0;
  const nowMs = deps.nowMs();
  const due = claimsDue(await autoCheckInputs(db), nowMs, deps.policy);
  if (due.length === 0) return 0;
  const windowId = await deps.browser.visibleWindow();
  if (windowId === null) {
    log.info('autocheck.no_window', { claims: due.length });
    return 0;
  }
  await deps.browser.openPinned(windowId, AUTO_CHECK_URL);
  const graceMs = deps.policy.windows.graceMin * MS_PER_MINUTE;
  await recordAutoCheck(db, {
    at: IsoTs.parse(isoWithLocalOffset(new Date(nowMs))),
    until: IsoTs.parse(isoWithLocalOffset(new Date(nowMs + graceMs))),
    claims: due.length,
    agents: [...new Set(due.map(({ agent }) => agent))],
  });
  log.info('autocheck.opened', { claims: due.length });
  deps.notify(['meta']);
  return due.length;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs one auto-check after any still running (header). Never rejects: a failure is logged (`autocheck.failed`) and
 * resolves 0; the next batch tries again.
 */
export function autoCheckGmail(deps: AutoCheckDeps): Promise<number> {
  const run = queue.then(() => checkOnce(deps));
  queue = run.catch(() => undefined);
  return run.catch((error: unknown) => {
    log.error('autocheck.failed', { error });
    return 0;
  });
}
