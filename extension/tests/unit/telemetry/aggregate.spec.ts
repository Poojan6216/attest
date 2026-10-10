import 'fake-indexeddb/auto';
/**
 * The opt-in telemetry's payload, built from a ledger (sprint_5 5.7; src/telemetry/aggregate.ts), for the last whole day
 * on the browser's clock: each agent's receipts graded that day, a FINAL one by its grade and a marked one by its mark,
 * PENDING, superseded and other days' left out; each reader's health reported that day, IDLE left out; the whole hours
 * each page reader's windows covered, overlaps counted once and single instants aside; and which readers are on. The
 * payload parses by its schema; with Chrome's version unknown there is none. Every instant is placed in the reported
 * day, so the test reads alike in any time zone. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isoWithLocalOffset } from '../../../src/clock';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../../../src/core/units';
import { saveFlag, saveReaderOff } from '../../../src/ledger/consent';
import { recordCoverage } from '../../../src/ledger/coverage-store';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putAdapterHealth, putReceipt } from '../../../src/ledger/repo';
import { buildTelemetry, reportedDay, type TelemetryDay } from '../../../src/telemetry/aggregate';
import { TelemetryPayload } from '../../../src/telemetry/schema';
import { claimId, makeHealth, makeReceipt, sha, ulid, uniqueDbName } from '../ledger/fixtures';

const FACTS = { installId: '4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b', extVersion: '0.1.0', chromeMajor: 154 };
const NOW = new Date(2026, 9, 10, 9, 30).getTime();
const DAY: TelemetryDay = reportedDay(NOW);
/** An instant `hours` into the reported day, written as the extension writes one. */
const at = (hours: number): string => isoWithLocalOffset(new Date(DAY.fromMs + hours * MS_PER_HOUR));

let db: LedgerDb;
beforeEach(async () => {
  db = await openLedger(uniqueDbName('telemetry-aggregate'));
});
afterEach(() => {
  db.close();
});

describe('reportedDay', () => {
  it('is the last whole day before now on the browser’s clock: yesterday, midnight to midnight', () => {
    expect(DAY.bucket).toBe('2026-10-09');
    expect(new Date(DAY.fromMs).getHours()).toBe(0);
    expect(DAY.toMs).toBe(new Date(2026, 9, 10).getTime());
    expect(reportedDay(DAY.toMs).bucket).toBe('2026-10-09');
    expect(reportedDay(DAY.toMs - 1).bucket).toBe('2026-10-08');
  });
});

/** A receipt of `agent` graded at `computedAt`, with `overrides`. */
async function receipt(n: number, computedAt: string, overrides: Parameters<typeof makeReceipt>[0] = {}) {
  await putReceipt(
    db,
    makeReceipt({
      id: ulid(500 + n),
      claimId: claimId(600 + n),
      inputsHash: sha(700 + n),
      computedAt,
      ...overrides,
    }),
  );
}

describe('buildTelemetry: the counts and the health', () => {
  it('counts each agent’s receipts graded that day: FINAL by grade, marked by the mark, the rest left out', async () => {
    const finalAt = (time: string) => ({ state: 'FINAL' as const, finalAt: time });
    await receipt(1, at(9), finalAt(at(9)));
    await receipt(2, at(10), { ...finalAt(at(10)), grade: 'PARTIAL', ruleId: 'partial' });
    await receipt(3, at(11), { agent: 'claude', ...finalAt(at(11)) });
    // Marked NOT_FOUND by the person over a computed VERIFIED: counted as NOT_FOUND.
    const override = {
      grade: 'NOT_FOUND' as const,
      reason: 'I sent it myself',
      at: at(12),
      previousState: 'FINAL' as const,
    };
    await receipt(4, at(11.5), {
      ...finalAt(at(11.5)),
      state: 'USER_OVERRIDDEN',
      reasons: [...makeReceipt().reasons, { code: 'override.user', params: { grade: 'NOT_FOUND' } }],
      override,
    });
    await receipt(5, at(13)); // PENDING: still checking.
    await receipt(6, at(-1), finalAt(at(-1))); // The day before.
    await receipt(7, at(24.5), finalAt(at(24.5))); // Today.
    const payload = await buildTelemetry(db, FACTS, DAY);
    expect(payload?.counts.muse).toEqual({
      VERIFIED: 1,
      PARTIAL: 1,
      NOT_FOUND: 1,
      UNASKED: 0,
      OVER_SCOPE: 0,
      UNVERIFIABLE: 0,
    });
    expect(payload?.counts.claude.VERIFIED).toBe(1);
    expect(payload?.counts.chatgpt).toEqual(payload?.counts.dots);
    expect(Object.values(payload?.counts.dots ?? {}).every((count) => count === 0)).toBe(true);
  });

  it('reports each reader’s health made that day, OK or DEGRADED, and nothing for an idle one or another day', async () => {
    await putAdapterHealth(db, makeHealth({ adapterId: 'gmail.sent', status: 'DEGRADED', checkedAt: at(8) }));
    await putAdapterHealth(db, makeHealth({ adapterId: 'gcal.event', status: 'IDLE', checkedAt: at(8) }));
    await putAdapterHealth(db, makeHealth({ adapterId: 'gmail.receipt', status: 'OK', checkedAt: at(-2) }));
    await putAdapterHealth(db, makeHealth({ adapterId: 'muse.chat', status: 'OK', checkedAt: at(3) }));
    expect((await buildTelemetry(db, FACTS, DAY))?.adapterHealth).toEqual({
      'gmail.sent': 'DEGRADED',
      'muse.chat': 'OK',
    });
  });
});

describe('buildTelemetry: the hours, the readers and the payload', () => {
  it('counts the whole hours each reader’s windows covered that day, overlaps once, instants aside', async () => {
    const entry = (source: 'gmail.sent' | 'gcal.event', from: number, to: number, synced = to) => ({
      observerId: source,
      source,
      accountHash: sha(1),
      lastSyncAt: at(synced),
      windowStart: at(from),
      windowEnd: at(to),
      ...(source === 'gcal.event' ? { allCalendars: true } : {}),
    });
    await recordCoverage(db, entry('gmail.sent', -3, 2)); // 2 hours of the day.
    await recordCoverage(db, entry('gmail.sent', 1, 4.5)); // 2.5 more, the overlap counted once.
    await recordCoverage(db, entry('gmail.sent', 6, 6)); // A single instant: no time.
    await recordCoverage(db, entry('gcal.event', 20, 30, 30)); // 4 hours of the day.
    const hours = (await buildTelemetry(db, FACTS, DAY))?.coverageHours;
    expect(hours).toEqual({ gmail: 4, gcal: 4 });
    expect(MS_PER_MINUTE).toBeLessThan(MS_PER_HOUR);
  });

  it('says which readers are on, every agent reader off, Dots off whatever its flag', async () => {
    await saveReaderOff(db, 'gcal', true);
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    const payload = await buildTelemetry(db, FACTS, DAY);
    expect(payload?.observersEnabled).toEqual({ gmail: true, gcal: false });
    expect(payload?.adaptersEnabled).toEqual({ muse: false, chatgpt: false, dots: false, claude: false });
  });

  it('is a payload the schema takes, holding the facts it was given and the day', async () => {
    const payload = await buildTelemetry(db, FACTS, DAY);
    expect(TelemetryPayload.parse(payload)).toEqual(payload);
    expect(payload).toMatchObject({ ...FACTS, dayBucket: '2026-10-09', adapterHealth: {} });
  });

  it('is none when Chrome’s version is unknown, or the extension’s is not three numbers', async () => {
    expect(await buildTelemetry(db, { ...FACTS, chromeMajor: null }, DAY)).toBeNull();
    expect(await buildTelemetry(db, { ...FACTS, extVersion: '0.1.0-beta' }, DAY)).toBeNull();
  });
});
