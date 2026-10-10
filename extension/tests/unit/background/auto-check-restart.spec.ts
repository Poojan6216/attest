import 'fake-indexeddb/auto';
/**
 * The Gmail auto-check across a stopped service worker (sprint_4 4.9: "exactly one pinned visible tab per window", "once
 * per grace window"; Decisions [4.9]; Sprint 4 QA review, qa_tester priority 7). Every open is recorded in the ledger,
 * never in memory, so a worker Chrome stops and starts again keeps the window: modelled as Chrome makes it
 * (tests/unit/background/grace-alarm.spec.ts), the ledger and `chrome.storage.local` stay, the connection and every
 * module's memory go (a fresh import). Then:
 *  - within the open's window, the next worker opens nothing;
 *  - after it, a claim that was due at the open never opens another tab; a claim due later opens one;
 *  - a worker stopped after the tab opened and before the open was recorded may open one more tab at its next check,
 *    but none once a Gmail Sent list was read since the claim (the decision's "only if the first was never read").
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import type { AutoCheckBrowser, AutoCheckDeps } from '../../../src/background/auto-check';
import { AUTO_CHECK_URL, STORAGE_KEYS } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putCoveragePing, putReceipt, upsertClaim } from '../../../src/ledger/repo';
import type { ReceiptInput } from '../../../src/ledger/types';
import { setLogSink } from '../../../src/log';
import {
  claimId,
  makeClaim,
  makePing,
  makeReceipt,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from '../ledger/fixtures';

const MINUTE = 60_000;
const READ_AT = '2026-10-01T10:30:00-04:00';
const READ_MS = Date.parse(READ_AT);
/** Half the shipped grace: a claim is due 15 minutes after Attest read it; an open holds the next for 30. */
const WAIT_MS = (DEFAULT_POLICY.windows.graceMin * MINUTE) / 2;
const WINDOW_MS = DEFAULT_POLICY.windows.graceMin * MINUTE;

const PENDING: Partial<ReceiptInput> = {
  grade: 'UNVERIFIABLE',
  ruleId: 'pending',
  reasons: [{ code: 'coverage.none', params: { source: 'gmail.sent' } }],
  observationIds: [],
  state: 'PENDING',
  finalFrom: '2026-10-01T22:00:00-04:00',
};

let name: string;
let opened: string[];
let restoreSink: () => void;

const tabs: AutoCheckBrowser = {
  visibleWindow: () => Promise.resolve(7),
  openPinned: (_windowId, url) => {
    opened.push(url);
    return Promise.resolve();
  },
};

/** A worker that opened the tab and stopped before it recorded the open: the record never reached the ledger. */
const stoppedAfterOpening: AutoCheckBrowser = {
  visibleWindow: () => Promise.resolve(7),
  openPinned: async (windowId, url) => {
    await tabs.openPinned(windowId, url);
    throw new Error('the service worker stopped');
  },
};

beforeEach(async () => {
  pinClock();
  fakeBrowser.reset();
  name = uniqueDbName('auto-check-restart');
  opened = [];
  restoreSink = setLogSink(() => undefined);
  await browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: { ATTEST_AUTO_CHECK_GMAIL: true } });
});

afterEach(() => {
  restoreSink();
  releaseClock();
});

/** Stores claim `n`, an email read at `observedAt`, with its PENDING receipt, in the ledger named `name`. */
async function storeClaim(n: number, observedAt: string): Promise<void> {
  const db = await openLedger(name);
  await upsertClaim(db, makeClaim({ rawHash: sha(n), observedAt }));
  await putReceipt(db, makeReceipt({ id: ulid(300 + n), claimId: claimId(n), ...PENDING }));
  db.close();
}

/**
 * One auto-check by a service worker started afresh at `nowMs`: new module instances, the ledger reopened by name,
 * `chrome.storage.local` as it was. Resolves how many claims it opened Gmail for.
 */
async function checkAfterRestart(nowMs: number, browserTabs: AutoCheckBrowser = tabs): Promise<number> {
  vi.resetModules();
  const [{ autoCheckGmail }, migrations, log] = await Promise.all([
    import('../../../src/background/auto-check'),
    import('../../../src/ledger/migrations'),
    import('../../../src/log'),
  ]);
  log.setLogSink(() => undefined);
  const db: LedgerDb = await migrations.openLedger(name);
  const deps: AutoCheckDeps = {
    db: () => Promise.resolve(db),
    storage: browser.storage.local,
    policy: DEFAULT_POLICY,
    nowMs: () => nowMs,
    browser: browserTabs,
    notify: () => undefined,
  };
  try {
    return await autoCheckGmail(deps);
  } finally {
    db.close();
  }
}

describe('the auto-check after the service worker restarts', () => {
  it('opens nothing more within the window, nor for a claim due at the open; a claim due later opens one', async () => {
    await storeClaim(1, READ_AT);
    expect(await checkAfterRestart(READ_MS + WAIT_MS)).toBe(1);
    expect(opened).toEqual([AUTO_CHECK_URL]);

    // A new worker, five minutes on, inside the window: nothing.
    expect(await checkAfterRestart(READ_MS + WAIT_MS + 5 * MINUTE)).toBe(0);
    // Another, after the window: claim 1 was due at the open, so it never opens another tab.
    expect(await checkAfterRestart(READ_MS + WAIT_MS + WINDOW_MS + MINUTE)).toBe(0);
    expect(opened).toHaveLength(1);

    // A claim read after the open is due 15 minutes later, outside the window: one tab, for it alone.
    await storeClaim(2, new Date(READ_MS + WAIT_MS + WINDOW_MS).toISOString());
    expect(await checkAfterRestart(READ_MS + 2 * WAIT_MS + WINDOW_MS)).toBe(1);
    expect(opened).toHaveLength(2);
  });

  it('opens one more tab after a stop between the tab and its record, when that tab was never read', async () => {
    await storeClaim(1, READ_AT);
    expect(await checkAfterRestart(READ_MS + WAIT_MS, stoppedAfterOpening)).toBe(0);
    expect(opened).toHaveLength(1);
    // Nothing was recorded and nothing read the Sent folder: the claim is still due and unseen (Decisions [4.9]).
    expect(await checkAfterRestart(READ_MS + WAIT_MS + 5 * MINUTE)).toBe(1);
    expect(opened).toHaveLength(2);
  });

  it('opens none after such a stop once the tab it opened read the Sent folder', async () => {
    await storeClaim(1, READ_AT);
    expect(await checkAfterRestart(READ_MS + WAIT_MS, stoppedAfterOpening)).toBe(0);
    // The tab read the Sent folder before the next check: the claim is no longer unseen, so nothing opens.
    const db = await openLedger(name);
    const syncedAt = new Date(READ_MS + WAIT_MS + MINUTE).toISOString();
    await putCoveragePing(db, makePing({ lastSyncAt: syncedAt, windowEnd: syncedAt }));
    db.close();
    expect(await checkAfterRestart(READ_MS + WAIT_MS + 5 * MINUTE)).toBe(0);
    expect(opened).toHaveLength(1);
  });

  it('opens nothing after a restart while the person keeps it off', async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.FLAGS]: { ATTEST_AUTO_CHECK_GMAIL: false } });
    await storeClaim(1, READ_AT);
    for (const after of [WAIT_MS, WAIT_MS + WINDOW_MS, 24 * 60 * MINUTE]) {
      expect(await checkAfterRestart(READ_MS + after)).toBe(0);
    }
    expect(opened).toEqual([]);
  });
});
