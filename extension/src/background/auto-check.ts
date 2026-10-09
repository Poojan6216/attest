/**
 * Auto-check Gmail (sprint_4 4.9; docs/privacy-architecture.md "Auto-check Gmail"): the one exception to Hard Rule 11,
 * off unless the person turns it on in the options page (flag ATTEST_AUTO_CHECK_GMAIL, ./flags.ts).
 *
 * After each grace batch (./alarms.ts), when the flag is on and the Gmail reader is on (./readers.ts), a claim is due
 * when it is an `email.sent` claim whose receipt has been PENDING, with no mark of the person's, for half its grace
 * (`graceMin` / 2) since Attest read it, and no Gmail Sent list has been read since Attest read it: no Gmail tab showed
 * Attest the Sent folder since. Then Attest opens AUTO_CHECK_URL, the Sent folder, in one new tab, pinned and active
 * in the window the person last used, never in the background; the Gmail reader reads it there as in any Gmail tab the
 * person opens, and never acts on the page (Hard Rule 3). No tab opens while no window is open or the last one used is
 * minimised (the next batch tries again).
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
import { AUTO_CHECK_URL } from '../config';
import { instantMs } from '../core/normalize';
import { DEFAULT_POLICY, type Policy } from '../core/policy';
import { IsoTs } from '../core/schema';
import { MS_PER_MINUTE } from '../core/units';
import {
  autoCheckInputs,
  type AutoCheckInputs,
  type CheckingEmailClaim,
  recordAutoCheck,
} from '../ledger/auto-check';
import type { LedgerDb } from '../ledger/db';
import { getLedger } from '../ledger/repo';
import { log } from '../log';
import { type FlagStorage, readFlags } from './flags';
import { readersOff } from './readers';

/** How long a claim is PENDING before it is due: half its grace (header). */
export const autoCheckWaitMs = (policy: Policy): number => (policy.windows.graceMin * MS_PER_MINUTE) / 2;

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
  /** The window the person last used, or null when none is open or it is minimised: no tab there could be seen. */
  readonly visibleWindow: () => Promise<number | null>;
  /** Opens `url` in a new pinned tab, active in window `windowId`. */
  readonly openPinned: (windowId: number, url: string) => Promise<void>;
}

/** Chrome's own. */
export const BROWSER_AUTO_CHECK: AutoCheckBrowser = {
  visibleWindow: async () => {
    try {
      const window = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
      return window.id === undefined || window.state === 'minimized' ? null : window.id;
    } catch {
      return null;
    }
  },
  openPinned: async (windowId, url) => {
    await browser.tabs.create({ windowId, url, pinned: true, active: true });
  },
};

export interface AutoCheckDeps {
  readonly db: () => Promise<LedgerDb>;
  /** `chrome.storage.local`: the flags and which readers are off. */
  readonly storage: FlagStorage;
  readonly policy: Policy;
  readonly nowMs: () => number;
  readonly browser: AutoCheckBrowser;
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

/** The service worker's: the shared ledger, `chrome.storage.local`, the shipped policy, the wall clock and Chrome. */
export function browserAutoCheck(notify: (tables: readonly LedgerTable[]) => void): AutoCheckDeps {
  return {
    db: getLedger,
    storage: browser.storage.local,
    policy: DEFAULT_POLICY,
    nowMs: () => Date.now(),
    browser: BROWSER_AUTO_CHECK,
    notify,
  };
}

/** One auto-check (header); resolves how many claims it opened Gmail for, 0 when it opened nothing. */
async function checkOnce(deps: AutoCheckDeps): Promise<number> {
  if (!(await readFlags(deps.storage)).ATTEST_AUTO_CHECK_GMAIL) return 0;
  if ((await readersOff(deps.storage)).has('gmail')) return 0;
  const db = await deps.db();
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
