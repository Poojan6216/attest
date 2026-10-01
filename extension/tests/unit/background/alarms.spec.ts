import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureAlarms, handleAlarm, isAttestAlarm, resetAlarms } from '../../../src/background/alarms';
import { ALARM_NAMES, PURGE_ALARM_PERIOD_MINUTES } from '../../../src/config';
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

afterEach(() => {
  restore();
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
    expect(records.map((r) => r.event)).toEqual(['alarm.fired', 'alarm.purge_pending_implementation']);
    expect(records[0]?.fields).toEqual({ alarm: ALARM_NAMES.PURGE });
  });

  it('ignores a foreign alarm without echoing its name', async () => {
    await handleAlarm({ name: 'evil.alarm' });
    expect(records).toEqual([{ level: 'warn', event: 'alarm.unknown', fields: {} }]);
  });
});
