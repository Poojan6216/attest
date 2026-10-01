/**
 * The service-worker entrypoint's wiring (entrypoints/background.ts), run against the fake browser. Added by
 * the Sprint 0 QA review: the entry had no unit test (onStartup and the install-failure path were never run).
 */
import 'fake-indexeddb/auto';

import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import background from '../../../entrypoints/background';
import { ALARM_NAMES, PURGE_ALARM_PERIOD_MINUTES, STORAGE_KEYS } from '../../../src/config';
import { type LogRecord, setLogSink } from '../../../src/log';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let records: LogRecord[] = [];
let restoreSink: () => void = () => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
  background.main();
});

afterEach(() => {
  restoreSink();
});

const events = (): string[] => records.map((r) => `${r.level}:${r.event}`);

async function storedId(): Promise<unknown> {
  return (await browser.storage.local.get(STORAGE_KEYS.INSTALL_ID))[STORAGE_KEYS.INSTALL_ID];
}

describe('background main()', () => {
  it('logs its start once', () => {
    expect(events()).toEqual(['info:background.started']);
  });

  it('on install: creates the install id, then schedules the purge alarm with its period', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await vi.waitFor(async () => {
      expect(await browser.alarms.get(ALARM_NAMES.PURGE)).toMatchObject({
        periodInMinutes: PURGE_ALARM_PERIOD_MINUTES,
      });
    });
    expect(await storedId()).toMatch(UUID_V4);
    expect(events().filter((e) => e.startsWith('error:'))).toEqual([]);
  });

  it('on browser startup: recreates a dropped alarm', async () => {
    expect(await browser.alarms.getAll()).toEqual([]);
    await fakeBrowser.runtime.onStartup.trigger();
    await vi.waitFor(async () => {
      expect((await browser.alarms.getAll()).map((a) => a.name)).toEqual([ALARM_NAMES.PURGE]);
    });
  });

  it('on our alarm: runs its handler', async () => {
    await fakeBrowser.alarms.onAlarm.trigger({
      name: ALARM_NAMES.PURGE,
      scheduledTime: 0,
      persistAcrossSessions: false,
    });
    await vi.waitFor(() => {
      expect(events()).toContain('info:alarm.fired');
    });
  });

  it('an install-id storage failure is logged loudly and does not stop the alarms being scheduled', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota'));
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await vi.waitFor(() => {
      expect(events()).toContain('error:install.failed');
    });
    // QA-3 (reviews/sprint_0/qa.md): RED until background.ts schedules alarms independently of the install
    // id. Today resetAlarms() runs only after handleInstalled() succeeds, so a storage failure leaves the
    // extension with no scheduler (purge now; grace and digest from Sprints 3 and 4) until the next restart.
    await vi.waitFor(async () => {
      expect(await browser.alarms.get(ALARM_NAMES.PURGE)).toBeDefined();
    });
  });
});
