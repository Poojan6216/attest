import 'fake-indexeddb/auto';

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureAlarms, handleAlarm, isAttestAlarm, resetAlarms } from '../../../src/background/alarms';
import { nextDigestMs } from '../../../src/ledger/digest-week';
import {
  ALARM_NAMES,
  GRADE_ALARM_PERIOD_MINUTES,
  GRADE_STARTUP_DELAY_MINUTES,
  TELEMETRY_ALARM_PERIOD_MINUTES,
  TELEMETRY_STARTUP_DELAY_MINUTES,
  PURGE_ALARM_PERIOD_MINUTES,
  PURGE_STARTUP_DELAY_MINUTES,
} from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { closeLedger, getLedger, getObservation, upsertObservation } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';
import { makeObservation, pinClock, releaseClock } from '../ledger/fixtures';

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
  it('creates each of our alarms once with its period, and the digest once at the next Monday 09:00', async () => {
    const before = Date.now();
    await resetAlarms();
    const alarms = await browser.alarms.getAll();
    expect(alarms.map((a) => [a.name, a.periodInMinutes])).toEqual([
      [ALARM_NAMES.PURGE, PURGE_ALARM_PERIOD_MINUTES],
      [ALARM_NAMES.GRADE, GRADE_ALARM_PERIOD_MINUTES],
      [ALARM_NAMES.DIGEST, undefined],
      [ALARM_NAMES.TELEMETRY, TELEMETRY_ALARM_PERIOD_MINUTES],
    ]);
    const digest = await browser.alarms.get(ALARM_NAMES.DIGEST);
    expect(digest?.scheduledTime).toBeGreaterThanOrEqual(nextDigestMs(before));
    expect(digest?.scheduledTime).toBeLessThanOrEqual(nextDigestMs(Date.now()));
  });

  it('clears foreign alarms and never duplicates ours when run twice', async () => {
    await browser.alarms.create('stale.from.old.version', { delayInMinutes: 5 });
    await resetAlarms();
    await resetAlarms();
    expect((await browser.alarms.getAll()).map((a) => a.name)).toEqual([
      ALARM_NAMES.PURGE,
      ALARM_NAMES.GRADE,
      ALARM_NAMES.DIGEST,
      ALARM_NAMES.TELEMETRY,
    ]);
  });
});

describe('ensureAlarms (browser startup)', () => {
  it('recreates a dropped alarm', async () => {
    await ensureAlarms();
    expect((await browser.alarms.getAll()).map((a) => a.name)).toEqual([
      ALARM_NAMES.PURGE,
      ALARM_NAMES.GRADE,
      ALARM_NAMES.DIGEST,
      ALARM_NAMES.TELEMETRY,
    ]);
  });

  it('a dropped grace alarm comes back due a minute after start, then every few minutes (sprint_3 3.13)', async () => {
    await ensureAlarms();
    const alarm = await browser.alarms.get(ALARM_NAMES.GRADE);
    expect([alarm?.periodInMinutes, GRADE_STARTUP_DELAY_MINUTES]).toEqual([GRADE_ALARM_PERIOD_MINUTES, 1]);
  });

  it('a dropped telemetry alarm comes back due two minutes after start, then hourly (sprint_5 5.7)', async () => {
    await ensureAlarms();
    const alarm = await browser.alarms.get(ALARM_NAMES.TELEMETRY);
    expect([alarm?.periodInMinutes, TELEMETRY_STARTUP_DELAY_MINUTES]).toEqual([
      TELEMETRY_ALARM_PERIOD_MINUTES,
      2,
    ]);
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

describe('the purge alarm trusts the clock only as far as the ledger (SEC-5)', () => {
  afterEach(() => {
    releaseClock();
  });

  it('firing with the clock a year ahead deletes nothing current, and says the clock is ahead', async () => {
    pinClock('2026-10-01T10:30:00-04:00');
    const db = await getLedger();
    await db.observations.clear();
    const current = makeObservation({
      occurredAt: '2026-10-01T10:14:00-04:00',
      observedAt: '2026-10-01T10:20:00-04:00',
    });
    await upsertObservation(db, current, DEFAULT_POLICY);
    pinClock('2027-10-01T10:30:00-04:00');
    await handleAlarm({ name: ALARM_NAMES.PURGE });
    expect(await getObservation(db, current.id)).toMatchObject({ contentHash: current.contentHash });
    expect(records.map((r) => r.event)).toEqual(['alarm.fired', 'ledger.purge_clock_ahead']);
  });
});
