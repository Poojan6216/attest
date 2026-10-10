import 'fake-indexeddb/auto';
/**
 * The catch-up after an unlock (src/background/catch-up.ts; sprint_6 6.7, the privacy pre-review's retention finding):
 * the alarms that wait while the ledger is locked run once after it is unlocked, so the purge never waits on a person
 * who unlocks only after it fires. The purge and the usage numbers run every time (each is idempotent); the digest of
 * the last whole week runs only once its Monday 09:00 has passed and only if it was not made, so no digest or notice
 * comes twice; a failure is logged under its alarm's name; and only an unlock that opened the ledger starts it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { runRetentionPurge } from '../../../src/background/alarms';
import { catchUpAfterUnlock, digestIfDue } from '../../../src/background/catch-up';
import {
  holdKeysHere,
  onCryptoEnable,
  onCryptoLock,
  onCryptoUnlock,
  onUnlocked,
  resumeCryptoJob,
} from '../../../src/background/crypto';
import { letSleep } from '../../../src/background/keep-awake';
import { runTelemetryAlarm } from '../../../src/background/telemetry';
import { ALARM_NAMES } from '../../../src/config';
import { clearKeyring } from '../../../src/crypto/keyring';
import { buildDigest, saveDigest } from '../../../src/ledger/digest';
import { lastWeek } from '../../../src/ledger/digest-week';
import { IsoTs } from '../../../src/ledger/types';
import { getLedger } from '../../../src/ledger/repo';
import { deleteLedger } from '../../../src/ledger/shared';
import { captureLogs } from '../bus/harness';

vi.mock('../../../src/background/alarms', () => ({ runRetentionPurge: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../src/background/telemetry', () => ({ runTelemetryAlarm: vi.fn(() => Promise.resolve()) }));

/** Monday 12 October 2026, local time: the digest of the week of 5 October is due at 09:00. */
const MONDAY_8 = new Date(2026, 9, 12, 8, 0).getTime();
const MONDAY_10 = new Date(2026, 9, 12, 10, 0).getTime();
const records = captureLogs();

beforeEach(() => {
  fakeBrowser.reset();
  holdKeysHere();
});

afterEach(async () => {
  letSleep();
  onUnlocked(() => Promise.resolve());
  await deleteLedger();
  clearKeyring();
});

describe('the digest after an unlock', () => {
  it('is made only once due, and only when the week has none', async () => {
    const make = vi.fn(() => Promise.resolve());
    expect(await digestIfDue(MONDAY_8, make)).toBe(false);
    expect(make).not.toHaveBeenCalled();
    expect(await digestIfDue(MONDAY_10, make)).toBe(true);
    expect(make).toHaveBeenCalledTimes(1);
    const db = await getLedger();
    await saveDigest(
      db,
      await buildDigest(db, lastWeek(MONDAY_10), IsoTs.parse('2026-10-12T10:00:00-04:00')),
    );
    expect(await digestIfDue(MONDAY_10, make)).toBe(false);
    expect(make).toHaveBeenCalledTimes(1);
  });
});

describe('the catch-up', () => {
  it('runs the purge and the usage numbers every time, and logs a failure under its alarm', async () => {
    vi.mocked(runRetentionPurge).mockRejectedValueOnce(new Error('purge failed'));
    await catchUpAfterUnlock(() => MONDAY_8);
    expect(runRetentionPurge).toHaveBeenCalledTimes(1);
    expect(runTelemetryAlarm).toHaveBeenCalledTimes(1);
    expect(records).toContainEqual(
      expect.objectContaining({
        event: 'alarm.handler_failed',
        fields: expect.objectContaining({ alarm: ALARM_NAMES.PURGE }) as unknown,
      }),
    );
  });

  it('starts after an unlock that opened the ledger, never after a wrong passphrase', async () => {
    const caughtUp = vi.fn(() => Promise.resolve());
    onUnlocked(caughtUp);
    const deps = { db: getLedger, notify: () => undefined };
    await onCryptoEnable({ type: 'crypto.enable', passphrase: 'an invented passphrase' }, deps);
    await resumeCryptoJob(deps);
    await onCryptoLock(deps);
    expect(
      await onCryptoUnlock({ type: 'crypto.unlock', passphrase: 'not the passphrase' }, deps),
    ).toMatchObject({
      ok: false,
    });
    expect(caughtUp).not.toHaveBeenCalled();
    expect(
      await onCryptoUnlock({ type: 'crypto.unlock', passphrase: 'an invented passphrase' }, deps),
    ).toEqual({
      ok: true,
    });
    expect(caughtUp).toHaveBeenCalledTimes(1);
  });
});
