import 'fake-indexeddb/auto';
/**
 * The opt-in telemetry's send (sprint_5 5.7; src/telemetry/send.ts), over a stand-in POST (never a network): off, it
 * builds and sends nothing; on, it sends the last whole day's payload once, exactly as built, and records the day only
 * when the API took it (204), so a refused or failed send is tried again and a sent day never goes twice; sends that
 * overlap make one call; and the log holds the status, never the payload. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveFlag } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { telemetrySentDay } from '../../../src/ledger/telemetry-sent';
import { type LogRecord, setLogSink } from '../../../src/log';
import { buildTelemetry, reportedDay } from '../../../src/telemetry/aggregate';
import { TelemetryPayload } from '../../../src/telemetry/schema';
import { sendTelemetry, type TelemetrySendDeps } from '../../../src/telemetry/send';
import { uniqueDbName } from '../ledger/fixtures';

const FACTS = { installId: '4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b', extVersion: '0.1.0', chromeMajor: 154 };
const NOW = new Date(2026, 9, 10, 9, 30).getTime();
const DAY = reportedDay(NOW);

let db: LedgerDb;
let records: LogRecord[];
let restore: () => void;
beforeEach(async () => {
  db = await openLedger(uniqueDbName('telemetry-send'));
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});
afterEach(() => {
  restore();
  db.close();
});

/** A stand-in POST answering `status`, recording each body. */
function poster(status = 204) {
  const bodies: string[] = [];
  const post = vi.fn((body: string) => {
    bodies.push(body);
    return Promise.resolve(new Response(null, { status }));
  });
  return { post, bodies };
}

const deps = (post: TelemetrySendDeps['post'], nowMs = NOW): TelemetrySendDeps => ({
  db,
  nowMs,
  facts: () => Promise.resolve(FACTS),
  ...(post === undefined ? {} : { post }),
});

describe('sendTelemetry', () => {
  it('sends nothing, and builds nothing, while telemetry is off', async () => {
    const { post } = poster();
    const facts = vi.fn(() => Promise.resolve(FACTS));
    expect(await sendTelemetry({ ...deps(post), facts })).toEqual({ outcome: 'off', day: DAY.bucket });
    expect(post).not.toHaveBeenCalled();
    expect(facts).not.toHaveBeenCalled();
  });

  it('sends the last whole day once, exactly the payload built, and records it', async () => {
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    const { post, bodies } = poster();
    expect(await sendTelemetry(deps(post))).toEqual({ outcome: 'sent', day: '2026-10-09' });
    const [body] = bodies;
    expect(TelemetryPayload.parse(JSON.parse(body ?? ''))).toEqual(await buildTelemetry(db, FACTS, DAY));
    expect(await telemetrySentDay(db)).toBe('2026-10-09');
    // The same day again, later the same day: nothing goes.
    expect(await sendTelemetry(deps(post, NOW + 3_600_000))).toEqual({
      outcome: 'already_sent',
      day: '2026-10-09',
    });
    expect(post).toHaveBeenCalledTimes(1);
    // The next day: the next day goes.
    expect((await sendTelemetry(deps(post, NOW + 86_400_000))).outcome).toBe('sent');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('records nothing when the API refuses or the call fails, so the next alarm tries again', async () => {
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    expect((await sendTelemetry(deps(poster(500).post))).outcome).toBe('failed');
    const throwing = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await sendTelemetry(deps(throwing))).outcome).toBe('failed');
    expect(await telemetrySentDay(db)).toBeNull();
    expect((await sendTelemetry(deps(poster().post))).outcome).toBe('sent');
    expect(
      records.filter(({ level }) => level === 'warn').map(({ event, fields }) => [event, fields]),
    ).toEqual([
      ['telemetry.refused', { status: 500 }],
      ['telemetry.send_failed', { error: expect.anything() as unknown }],
    ]);
    expect(JSON.stringify(records)).not.toContain(FACTS.installId);
  });

  it('makes one call for sends that overlap (the alarm and the button at once)', async () => {
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    const { post } = poster();
    const both = await Promise.all([sendTelemetry(deps(post)), sendTelemetry(deps(post))]);
    expect(both.map(({ outcome }) => outcome)).toEqual(['sent', 'sent']);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the payload cannot be built (Chrome’s version unknown)', async () => {
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    const { post } = poster();
    const unknown = { ...deps(post), facts: () => Promise.resolve({ ...FACTS, chromeMajor: null }) };
    expect((await sendTelemetry(unknown)).outcome).toBe('not_built');
    expect(post).not.toHaveBeenCalled();
  });
});
