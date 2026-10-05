import 'fake-indexeddb/auto';

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureAlarms, handleAlarm, isAttestAlarm, resetAlarms } from '../../../src/background/alarms';
import { ALARM_NAMES, PURGE_ALARM_PERIOD_MINUTES, PURGE_STARTUP_DELAY_MINUTES } from '../../../src/config';
import { closeLedger } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';

let records: LogRecord[] = [];
let restore: () => void = () => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(async () => {
  restore();
  await closeLedger();
});

describe('alarm names', () => {
  it('recognises only our own constant alarm names', () => {
    expect(isAttestAlarm(ALARM_NAMES.PURGE)).toBe(true);
    expect(isAttestAlarm('someone.else')).toBe(false);
    expect(isAttestAlarm('')).toBe(false);
  });
});

describe('resetAlarms (install/update)', () => {
  it('creates each of our alarms once with its period', async () => {
    await resetAlarms();
    const alarms = await browser.alarms.getAll();
    expect(alarms.map((a) => a.name)).toEqual([ALARM_NAMES.PURGE]);
    expect(alarms[0]?.periodInMinutes).toBe(PURGE_ALARM_PERIOD_MINUTES);
  });

  it('clears foreign alarms and never duplicates ours when run twice', async () => {
    await browser.alarms.create('stale.from.old.version', { delayInMinutes: 5 });
    await resetAlarms();
    await resetAlarms();
    expect((await browser.alarms.getAll()).map((a) => a.name)).toEqual([ALARM_NAMES.PURGE]);
  });
});

describe('ensureAlarms (browser startup)', () => {
  it('recreates a dropped alarm', async () => {
    await ensureAlarms();
    expect((await browser.alarms.getAll()).map((a) => a.name)).toEqual([ALARM_NAMES.PURGE]);
  });

  it('a dropped purge alarm comes back due shortly after start, then daily (a daily restart still purges)', async () => {
    const createdAt = Date.now();
    await ensureAlarms();
    const alarm = await browser.alarms.get(ALARM_NAMES.PURGE);
    expect(alarm?.periodInMinutes).toBe(PURGE_ALARM_PERIOD_MINUTES);
    expect(PURGE_STARTUP_DELAY_MINUTES).toBeLessThan(PURGE_ALARM_PERIOD_MINUTES / 60);
    const dueInMs = (alarm?.scheduledTime ?? 0) - createdAt;
    expect(dueInMs).toBeGreaterThanOrEqual(PURGE_STARTUP_DELAY_MINUTES * 60_000 - 1_000);
    expect(dueInMs).toBeLessThanOrEqual(PURGE_STARTUP_DELAY_MINUTES * 60_000 + 5_000);
  });

  it('leaves an existing alarm (and its schedule) untouched', async () => {
    await browser.alarms.create(ALARM_NAMES.PURGE, { delayInMinutes: 3 });
    const before = await browser.alarms.get(ALARM_NAMES.PURGE);
    await ensureAlarms();
    const after = await browser.alarms.get(ALARM_NAMES.PURGE);
    expect(after?.scheduledTime).toBe(before?.scheduledTime);
    expect(after?.periodInMinutes).toBeUndefined();
  });
});

describe('handleAlarm', () => {
  it('logs our alarm by name and runs its handler', async () => {
    await handleAlarm({ name: ALARM_NAMES.PURGE });
    // The handler is the retention purge (Sprint 2.6): on an empty ledger it logs nothing more.
    expect(records.map((r) => r.event)).toEqual(['alarm.fired']);
    expect(records[0]?.fields).toEqual({ alarm: ALARM_NAMES.PURGE });
  });

  it('ignores a foreign alarm without echoing its name', async () => {
    await handleAlarm({ name: 'evil.alarm' });
    expect(records).toEqual([{ level: 'warn', event: 'alarm.unknown', fields: {} }]);
  });

  // Added by the Sprint 0 QA review: the "never throws" contract had no test.
  it('never rejects when a handler throws; logs the failure with the alarm name', async () => {
    await closeLedger();
    vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
      throw new TypeError('handler blew up');
    });
    await expect(handleAlarm({ name: ALARM_NAMES.PURGE })).resolves.toBeUndefined();
    expect(records[0]).toEqual({ level: 'info', event: 'alarm.fired', fields: { alarm: ALARM_NAMES.PURGE } });
    expect(records.filter((r) => r.event === 'alarm.handler_failed')).toEqual([
      {
        level: 'error',
        event: 'alarm.handler_failed',
        fields: { alarm: ALARM_NAMES.PURGE, error: 'LedgerError code=open_failed messageLength=39' },
      },
    ]);
  });
});
