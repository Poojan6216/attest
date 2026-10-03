/**
 * The last batch instant and the `observedAt` a new row is stored with (src/ledger/batch-instant.ts; docs/grading.md
 * §3; R3-LEDGER-1, RP3-3; Hard Rule 4). A batch records its instant before it reads; a row is stamped where it is
 * written, never at or before the instant of a batch that did not read it, and never earlier than now.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isoWithLocalOffset } from '../../../src/clock';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { IsoTs } from '../../../src/core/schema';
import { LAST_EVALUATED_AT, lastBatchMs, stampObservedAt } from '../../../src/ledger/batch-instant';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  getClaim,
  getMeta,
  getObservation,
  recordBatchInstant,
  setMeta,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import {
  captureLogs,
  expectLedgerError,
  makeClaim,
  makeObservation,
  pinClock,
  releaseClock,
  uniqueDbName,
} from './fixtures';

const ts = (value: string) => IsoTs.parse(value);
const T = '2026-10-01T12:00:00Z';
const T_MS = Date.parse(T);

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('batch-instant'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('stampObservedAt: the latest of the sighting, now and the last batch + 1 ms', () => {
  const NOW = ts('2026-10-01T11:00:00Z');
  const CASES: readonly (readonly [string, string, number | undefined, number | string])[] = [
    ['a sighting after now, no batch yet: as sighted', '2026-10-01T11:00:00.001+00:00', undefined, 'sighted'],
    [
      'a sighting at now: as sighted, its own spelling kept',
      '2026-10-01T07:00:00-04:00',
      undefined,
      'sighted',
    ],
    ['a sighting before now: now', '2026-10-01T10:59:59.999Z', undefined, Date.parse(NOW)],
    ['a sighting after now and the batch: as sighted', '2026-10-01T11:30:00Z', T_MS - 3_600_000, 'sighted'],
    ['a batch after now, a sighting before it: the batch + 1 ms', '2026-10-01T09:00:00Z', T_MS, T_MS + 1],
    ['a sighting at the batch instant: the batch + 1 ms', T, T_MS, T_MS + 1],
    ['a sighting 1 ms after the batch: as sighted', '2026-10-01T12:00:00.001Z', T_MS, 'sighted'],
    [
      'a batch at now exactly: the batch + 1 ms',
      '2026-10-01T10:00:00Z',
      Date.parse(NOW),
      Date.parse(NOW) + 1,
    ],
  ];

  it.each(CASES)('%s', (_label, sighted, lastMs, expected) => {
    const stamped = stampObservedAt(ts(sighted), NOW, lastMs);
    if (expected === 'sighted') expect(stamped).toBe(sighted);
    else expect(Date.parse(stamped)).toBe(expected);
    expect(IsoTs.safeParse(stamped).success).toBe(true);
  });

  it('writes now as src/clock.ts spelled it, and the batch floor with the local offset', () => {
    expect(stampObservedAt(ts('2026-10-01T09:00:00Z'), NOW, undefined)).toBe(NOW);
    expect(stampObservedAt(ts('2026-10-01T09:00:00Z'), NOW, T_MS)).toBe(
      isoWithLocalOffset(new Date(T_MS + 1)),
    );
  });
});

describe('recordBatchInstant: each batch instant is later than the last', () => {
  it('records the instant, and a later one replaces it', async () => {
    expect(await lastBatchMs(db)).toBeUndefined();
    await recordBatchInstant(db, T);
    expect(await lastBatchMs(db)).toBe(T_MS);
    expect(await getMeta(db, LAST_EVALUATED_AT)).toBe(T);
    await recordBatchInstant(db, '2026-10-01T08:00:01-04:00');
    expect(await lastBatchMs(db)).toBe(T_MS + 1000);
  });

  it.each([
    ['the same instant', T],
    ['the same instant in another offset', '2026-10-01T08:00:00-04:00'],
    ['an earlier instant (a clock that went back)', '2026-10-01T11:59:59.999Z'],
  ])('refuses %s with batch_out_of_order and writes nothing', async (_label, instant) => {
    await recordBatchInstant(db, T);
    const error = await expectLedgerError(recordBatchInstant(db, instant), 'batch_out_of_order');
    expect(error.context).toStrictEqual({ table: 'meta' });
    expect(await getMeta(db, LAST_EVALUATED_AT)).toBe(T);
  });

  it('refuses a malformed instant with invalid_input', async () => {
    await expectLedgerError(recordBatchInstant(db, '2026-10-01T12:00:00'), 'invalid_input');
    expect(await lastBatchMs(db)).toBeUndefined();
  });

  it('runs inside the batch transaction; a refused instant aborts it', async () => {
    await recordBatchInstant(db, T);
    const batch = (instant: string) =>
      db.transaction('rw', [db.claims, db.observations, db.meta], async () => {
        await recordBatchInstant(db, instant);
        return db.claims.count();
      });
    expect(await batch('2026-10-01T13:00:00Z')).toBe(0);
    await expectLedgerError(batch('2026-10-01T12:30:00Z'), 'batch_out_of_order');
    expect(await lastBatchMs(db)).toBe(Date.parse('2026-10-01T13:00:00Z'));
  });
});

describe('the last batch instant is written only by recordBatchInstant', () => {
  it('setMeta cannot write or move the last batch instant', async () => {
    await recordBatchInstant(db, T);
    const error = await expectLedgerError(
      setMeta(db, LAST_EVALUATED_AT, '2026-01-01T00:00:00Z'),
      'invalid_input',
    );
    expect(error.context).toStrictEqual({ table: 'meta', paths: 'key' });
    expect(await getMeta(db, LAST_EVALUATED_AT)).toBe(T);
  });

  it('an unreadable stored instant reads as none (logged by key only) and the next batch replaces it', async () => {
    await db.meta.put({ key: LAST_EVALUATED_AT, value: 'not a timestamp' });
    const logs = captureLogs();
    try {
      expect(await lastBatchMs(db)).toBeUndefined();
    } finally {
      logs.restore();
    }
    expect(logs.records.map((record) => record.event)).toEqual(['ledger.row_invalid']);
    expect(JSON.stringify(logs.records)).not.toContain('not a timestamp');
    await recordBatchInstant(db, T);
    expect(await lastBatchMs(db)).toBe(T_MS);
  });
});

describe('a new row is stamped where it is written', () => {
  it('a row written after it was sighted is stored at the instant it is written', async () => {
    pinClock('2026-10-01T10:35:00-04:00');
    const observation = makeObservation(); // sighted 10:20-04:00
    await upsertObservation(db, observation, DEFAULT_POLICY);
    const stored = await getObservation(db, observation.id);
    expect(Date.parse(stored?.observedAt ?? '')).toBe(Date.parse('2026-10-01T10:35:00-04:00'));
    expect(stored).toEqual({ ...observation, observedAt: stored?.observedAt });
  });

  it('after a batch, a row sighted before it is stored 1 ms after it, even when the clock reads earlier', async () => {
    pinClock(T);
    await recordBatchInstant(db, T);
    pinClock('2026-10-01T09:00:00Z'); // the clock went back
    const claim = makeClaim({ observedAt: '2026-10-01T07:30:00-04:00' }); // sighted before the batch
    await upsertClaim(db, claim);
    const observation = makeObservation({ observedAt: T });
    await upsertObservation(db, observation, DEFAULT_POLICY);
    expect(Date.parse((await getClaim(db, claim.id))?.observedAt ?? '')).toBe(T_MS + 1);
    expect(Date.parse((await getObservation(db, observation.id))?.observedAt ?? '')).toBe(T_MS + 1);
  });

  it('a sighting later than now and the last batch is stored exactly as sighted', async () => {
    await recordBatchInstant(db, '2026-10-01T10:00:00-04:00');
    const claim = makeClaim({ observedAt: '2026-10-01T10:30:00.123456-04:00' });
    await upsertClaim(db, claim);
    expect(await getClaim(db, claim.id)).toEqual(claim);
  });
});
