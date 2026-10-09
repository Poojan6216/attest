import 'fake-indexeddb/auto';
/**
 * The weekly digest in the service worker (sprint_4 4.7; src/background/digest.ts): on the digest alarm the next one is
 * set first, for the next Monday at 09:00; the last whole week's digest is made and kept, open pages are told, and a
 * notification says it is ready; a late alarm makes the same week's digest, which replaces itself. A click on that
 * notification opens the digest page (src/background/alerts.ts). Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onAlertClicked, type OpenDeps } from '../../../src/background/alerts';
import { type DigestDeps, runWeeklyDigest } from '../../../src/background/digest';
import { DIGEST_NOTIFICATION_ID } from '../../../src/config';
import type { LedgerDb } from '../../../src/ledger/db';
import { digestWeeks, getDigest } from '../../../src/ledger/digest';
import { nextDigestMs } from '../../../src/ledger/digest-week';
import { openLedger } from '../../../src/ledger/migrations';
import { setLogSink } from '../../../src/log';
import { uniqueDbName } from '../ledger/fixtures';

let db: LedgerDb;
let nowMs: number;
let deps: DigestDeps & {
  notify: ReturnType<typeof vi.fn<DigestDeps['notify']>>;
  schedule: ReturnType<typeof vi.fn<DigestDeps['schedule']>>;
};
let created: [string, string, string][];

beforeEach(async () => {
  db = await openLedger(uniqueDbName('digest-worker'));
  nowMs = new Date(2026, 9, 12, 9, 0).getTime();
  created = [];
  deps = {
    db: () => Promise.resolve(db),
    nowMs: () => nowMs,
    notify: vi.fn<DigestDeps['notify']>(),
    notifications: {
      create: (id, { title, message }) => {
        created.push([id, title, message]);
        return Promise.resolve(id);
      },
      clear: () => Promise.resolve(true),
    },
    iconUrl: () => 'chrome-extension://attest/icon/128.png',
    schedule: vi.fn<DigestDeps['schedule']>(() => Promise.resolve()),
  };
  setLogSink(() => undefined);
});

afterEach(() => {
  db.close();
});

describe('runWeeklyDigest', () => {
  it('sets the next alarm, keeps the last week’s digest, tells the pages, and says it is ready', async () => {
    await runWeeklyDigest(deps);
    expect(deps.schedule.mock.calls).toEqual([[nextDigestMs(nowMs)]]);
    expect(new Date(deps.schedule.mock.calls[0]?.[0] ?? 0).getDate()).toBe(19);
    expect(await digestWeeks(db)).toEqual(['2026-10-05']);
    expect((await getDigest(db, '2026-10-05'))?.createdAt.slice(0, 16)).toBe('2026-10-12T09:00');
    expect(deps.notify.mock.calls).toEqual([[['digests']]]);
    expect(created).toEqual([
      [
        DIGEST_NOTIFICATION_ID,
        'Your weekly digest',
        'Week of 5 Oct 2026: Nothing to look at: no receipt ended Not found, Unasked or Over scope.',
      ],
    ]);
  });

  it('a late alarm makes the same week’s digest, replacing it; a failing build still set the next alarm', async () => {
    await runWeeklyDigest(deps);
    nowMs = new Date(2026, 9, 14, 18, 0).getTime();
    await runWeeklyDigest(deps);
    expect(await digestWeeks(db)).toEqual(['2026-10-05']);
    deps = { ...deps, db: () => Promise.reject(new Error('no ledger')) };
    await expect(runWeeklyDigest(deps)).rejects.toThrow('no ledger');
    expect(deps.schedule).toHaveBeenCalledTimes(3);
  });
});

describe('a click on the digest notification', () => {
  it('opens the digest page in a tab and clears the notification', async () => {
    const open = {
      openSidePanel: vi.fn(() => Promise.resolve()),
      openTab: vi.fn(() => Promise.resolve()),
      name: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve(true)),
      pageUrl: (path: string) => `chrome-extension://attest${path}`,
    } satisfies OpenDeps;
    onAlertClicked(DIGEST_NOTIFICATION_ID, open);
    await vi.waitFor(() => {
      expect(open.openTab).toHaveBeenCalledWith('chrome-extension://attest/digest.html');
    });
    expect(open.clear).toHaveBeenCalledWith(DIGEST_NOTIFICATION_ID);
    expect(open.openSidePanel).not.toHaveBeenCalled();
  });
});
