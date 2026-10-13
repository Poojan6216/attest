import 'fake-indexeddb/auto';
/**
 * What each grace alarm keeps in order after its batch (src/background/alarms.ts `graceUpkeep`; sprint_4 close: tech
 * review TECH-6, QA review GAP 12), and the move of an older profile's choices into the ledger
 * (src/background/consent-move.ts; security review SEC-3). The upkeep runs whether the batch ran or failed; it shows the
 * alerts a stopped worker left pending, sets the weekly digest's alarm again when it was lost, and registers the readers
 * the person has on. The move carries each reader that was off and Check Gmail for me into ledger meta, reads a choice
 * it cannot read as every reader off, carries no other flag, and removes the old keys. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { graceUpkeep, runGraceBatch } from '../../../src/background/alarms';
import { moveStoredChoices } from '../../../src/background/consent-move';
import { ALARM_NAMES, FEATURE_FLAG_DEFAULTS, STORAGE_KEYS } from '../../../src/config';
import { queueAlerts } from '../../../src/ledger/alerts';
import { readersOff, readFlags } from '../../../src/ledger/consent';
import { nextDigestMs } from '../../../src/ledger/digest-week';
import { deleteLedger, getLedger } from '../../../src/ledger/shared';
import { Receipt } from '../../../src/ledger/types';
import { FIRST_LEDGER_BUCKET } from '../../../src/ledger/place';
import { setLogSink } from '../../../src/log';
import { makeReceipt, pinClock, releaseClock, ulid } from '../ledger/fixtures';
import { asFreshInstall, type FakeScripting } from './chrome-fakes';

let scripting: FakeScripting;
let restore: () => void;

beforeEach(() => {
  pinClock('2026-10-09T10:00:00-04:00');
  fakeBrowser.reset();
  scripting = asFreshInstall();
  restore = setLogSink(() => undefined);
});

afterEach(async () => {
  restore();
  await deleteLedger();
  releaseClock();
});

describe('the grace alarm’s upkeep', () => {
  it('shows an alert a stopped worker left pending, sets a lost digest alarm again, and registers the readers', async () => {
    const receipt = Receipt.parse(
      makeReceipt({
        id: ulid(7),
        grade: 'NOT_FOUND',
        ruleId: 'not_found',
        reasons: [{ code: 'match.none', params: {} }],
        observationIds: [],
        state: 'FINAL',
        finalAt: '2026-10-09T09:00:00-04:00',
      }),
    );
    await queueAlerts(await getLedger(), [receipt]);
    expect(await browser.alarms.get(ALARM_NAMES.DIGEST)).toBeUndefined();

    await graceUpkeep();

    expect((await (await getLedger()).alerts.get(ulid(7)))?.state).not.toBe('pending');
    expect((await browser.alarms.get(ALARM_NAMES.DIGEST))?.scheduledTime).toBe(nextDigestMs(Date.now()));
    expect([...scripting.registered.keys()].sort()).toEqual(['gcal', 'gmail']);
  });

  it('runs after a batch that failed, and the failure still reaches the alarm’s log', async () => {
    const upkeep = vi.fn(() => Promise.resolve());
    const db = await getLedger();
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw new Error('the batch failed');
    });
    await expect(runGraceBatch(() => undefined, upkeep)).rejects.toThrow('the batch failed');
    expect(upkeep).toHaveBeenCalledOnce();
  });
});

describe('moving an older profile’s choices into the ledger', () => {
  it('carries each reader that was off and Check Gmail for me, then removes the old keys', async () => {
    await browser.storage.local.set({
      [STORAGE_KEYS.READERS_OFF]: ['gcal'],
      [STORAGE_KEYS.FLAGS]: { ATTEST_AUTO_CHECK_GMAIL: true, ATTEST_TELEMETRY: true },
    });
    const db = await getLedger();
    expect(await moveStoredChoices(db, browser.storage.local)).toBe(2);
    expect(await readersOff(db)).toEqual(new Set(['gcal']));
    expect(await readFlags(db)).toEqual({ ...FEATURE_FLAG_DEFAULTS, ATTEST_AUTO_CHECK_GMAIL: true });
    // The old keys gone; the name of the ledger's bucket stays (src/ledger/place.ts).
    expect(await browser.storage.local.get(null)).toEqual({
      [STORAGE_KEYS.LEDGER_BUCKET]: FIRST_LEDGER_BUCKET,
    });
  });

  it('reads a readers’ choice it cannot read as every reader off, and carries no flag it cannot read', async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.READERS_OFF]: 'gmail', [STORAGE_KEYS.FLAGS]: 'on' });
    const db = await getLedger();
    expect(await moveStoredChoices(db, browser.storage.local)).toBe(2);
    expect(await readersOff(db)).toEqual(new Set(['gmail', 'gcal']));
    expect(await readFlags(db)).toEqual(FEATURE_FLAG_DEFAULTS);
  });

  it('does nothing when nothing is stored', async () => {
    const db = await getLedger();
    expect(await moveStoredChoices(db, browser.storage.local)).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });
});
