import 'fake-indexeddb/auto';
/**
 * The service worker while the ledger is encrypted and locked (src/background/locked.ts, alarms.ts; sprint_6 6.5):
 * every observer message is answered `locked` and nothing of it is stored, its coverage least of all (Hard Rule 5); a
 * pasted import is answered `locked`; the alarms that read or write the sealed tables wait, and the grace alarm keeps
 * only its upkeep; and Delete all data forgets the keys, leaving a ledger with nothing to unlock.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { handleAlarm } from '../../../src/background/alarms';
import { holdKeysHere, onCryptoEnable, resumeCryptoJob } from '../../../src/background/crypto';
import { letSleep } from '../../../src/background/keep-awake';
import { createHandlers } from '../../../src/background/router';
import { onLedgerWipe } from '../../../src/background/settings';
import { listen } from '../../../src/bus/listen';
import { sendChecked } from '../../../src/bus/send';
import { ALARM_NAMES } from '../../../src/config';
import { clearKeyring, isLocked, setKeyring } from '../../../src/crypto/keyring';
import { readSessionKeys } from '../../../src/crypto/session';
import { readCryptoState } from '../../../src/ledger/crypto-state';
import type { LedgerDb } from '../../../src/ledger/db';
import { getLedger } from '../../../src/ledger/repo';
import { deleteLedger } from '../../../src/ledger/shared';
import { captureLogs, connectAs, contentScript, extensionPage, VALID } from '../bus/harness';
import { makeObservation, makePing, pinClock, releaseClock } from '../ledger/fixtures';
import { contextOf, healthOf, pingOf, rowsOf } from './observer-harness';

const LOCKED = { sealing: true, guarded: true } as const;
const GMAIL_PAGE = 'https://mail.google.com/mail/u/0/#sent';
const records = captureLogs();
let stop: () => void = () => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  pinClock();
  holdKeysHere();
});

afterEach(async () => {
  stop();
  letSleep();
  await deleteLedger();
  clearKeyring();
  releaseClock();
});

async function countsOf(db: LedgerDb): Promise<readonly number[]> {
  return Promise.all([db.adapterHealth.count(), db.observations.count(), db.coverage.count()]);
}

describe('observer messages and imports while locked', () => {
  it('answers every observer message `locked` and stores none of it, coverage included', async () => {
    const db = await getLedger();
    setKeyring(LOCKED);
    connectAs({ ...contentScript(), url: GMAIL_PAGE, tab: { id: 7 } as never });
    stop = listen(createHandlers(() => '2026-10-01T10:30:00-04:00', contextOf(db)));
    const sighted = '2026-10-01T10:20:00-04:00';
    const ping = makePing({
      observerId: 'gmail.sent',
      lastSyncAt: sighted,
      windowStart: '2026-10-01T09:00:00-04:00',
      windowEnd: sighted,
    });
    for (const message of [
      healthOf('gmail.sent', sighted),
      rowsOf('gmail.sent', [makeObservation({ observedAt: sighted })]),
      pingOf(ping),
    ]) {
      expect(await sendChecked(message)).toEqual({ ok: false, code: 'locked' });
    }
    // Counted unlocked: locked, a content table refuses even a count.
    setKeyring({ sealing: false, guarded: false });
    expect(await countsOf(db)).toEqual([0, 0, 0]);
    expect(await sendChecked(healthOf('gmail.sent', sighted))).toEqual({ ok: true });
  });

  it('answers a pasted import `locked`', async () => {
    await getLedger();
    setKeyring(LOCKED);
    const handlers = createHandlers();
    const answer = await handlers['claims.import']?.(
      VALID['claims.import'],
      extensionPage('/sidepanel.html'),
    );
    expect(answer).toEqual({ ok: false, code: 'locked' });
  });
});

describe('alarms while locked', () => {
  it('lets the purge wait, and keeps only the upkeep of the grace alarm', async () => {
    await getLedger();
    setKeyring(LOCKED);
    records.length = 0;
    await handleAlarm({ name: ALARM_NAMES.PURGE });
    await handleAlarm({ name: ALARM_NAMES.GRADE });
    const events = records.map((record) => record.event);
    expect(events.filter((event) => event === 'alarm.locked')).toHaveLength(1);
    expect(events).not.toContain('alarm.handler_failed');
    expect((await fakeBrowser.alarms.getAll()).map((alarm) => alarm.name).sort()).toEqual(
      Object.values(ALARM_NAMES).sort(),
    );
  });
});

describe('Delete all data while encrypted', () => {
  it('forgets the keys, and the new ledger has nothing to unlock', async () => {
    const deps = { db: getLedger, notify: () => undefined };
    expect(
      await onCryptoEnable({ type: 'crypto.enable', passphrase: 'an invented passphrase' }, deps),
    ).toEqual({
      ok: true,
    });
    await resumeCryptoJob(deps);
    expect((await readSessionKeys()).current).toBeDefined();
    const wiped = await onLedgerWipe({
      notify: () => undefined,
      clearStorage: () => Promise.resolve(),
      clearNotifications: () => Promise.resolve(),
      syncReaders: () => Promise.resolve(),
    });
    expect(wiped).toEqual({ ok: true });
    expect(await readSessionKeys()).toEqual({});
    expect(await readCryptoState(await getLedger())).toEqual({ on: false });
    expect(isLocked()).toBe(false);
  });
});
