/**
 * The daily purge alarm runs the retention purge (src/background/alarms.ts `runRetentionPurge`; Sprint 2.6) on the
 * extension's own ledger, with the clock read at the edge, and a failing purge is logged with the alarm name, never
 * thrown out of the listener.
 */
import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleAlarm, runRetentionPurge } from '../../../src/background/alarms';
import { ALARM_NAMES } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { closeLedger, getLedger, getObservation, upsertObservation } from '../../../src/ledger/repo';
import { captureLogs, makeObservation, pinClock, releaseClock, sha } from './fixtures';

const OLD = makeObservation({
  rowKeyHash: sha(1),
  occurredAt: '2026-06-01T10:00:00Z',
  observedAt: '2026-06-01T10:05:00Z',
});
const FRESH = makeObservation({
  rowKeyHash: sha(2),
  occurredAt: '2026-09-30T10:00:00Z',
  observedAt: '2026-09-30T10:05:00Z',
});

afterEach(async () => {
  const db = await getLedger();
  await Promise.all(db.tables.map((table) => table.clear()));
  await closeLedger();
  releaseClock();
});

async function seed(): Promise<void> {
  pinClock();
  const db = await getLedger();
  for (const row of [OLD, FRESH]) await upsertObservation(db, row, DEFAULT_POLICY);
}

describe('the purge alarm', () => {
  it('purges the shared ledger 90 days back from now', async () => {
    await seed();
    pinClock('2026-10-01T12:00:00Z');
    const logs = captureLogs();
    try {
      await handleAlarm({ name: ALARM_NAMES.PURGE });
    } finally {
      logs.restore();
    }
    const db = await getLedger();
    expect(await getObservation(db, OLD.id)).toBeUndefined();
    expect(await getObservation(db, FRESH.id)).toEqual(FRESH);
    expect(logs.records.map((record) => record.event)).toEqual(['alarm.fired']);
  });

  it('runRetentionPurge rejects when the ledger cannot be opened, and handleAlarm logs it by alarm name', async () => {
    vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'InvalidStateError');
    });
    await closeLedger();
    await expect(runRetentionPurge()).rejects.toThrow();
    const logs = captureLogs();
    try {
      await handleAlarm({ name: ALARM_NAMES.PURGE });
    } finally {
      logs.restore();
    }
    expect(logs.records.map((record) => record.event)).toContain('alarm.handler_failed');
    expect(logs.records.find((record) => record.event === 'alarm.handler_failed')?.fields).toMatchObject({
      alarm: ALARM_NAMES.PURGE,
    });
    vi.restoreAllMocks();
  });
});
