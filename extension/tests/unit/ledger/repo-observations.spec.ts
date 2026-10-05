import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LEDGER_TIME_BUCKET_MINUTES } from '../../../src/config';
import { candidates } from '../../../src/core/candidates';
import { createMemoryIndex } from '../../../src/core/candidates-index';
import { idFromHash } from '../../../src/core/hash';
import { project } from '../../../src/core/redact';
import { Claim } from '../../../src/core/schema';
import type { LedgerDb } from '../../../src/ledger/db';
import { LedgerError } from '../../../src/ledger/errors';
import { INDEX_FIELDS, timeBucketOf } from '../../../src/ledger/index-fields';
import { openLedger } from '../../../src/ledger/migrations';
import { getObservation, observationsByTypeAndBuckets, upsertObservation } from '../../../src/ledger/repo';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ActionType, ObservationInput } from '../../../src/ledger/types';
import {
  expectLedgerError,
  makeObservation,
  makeReceiptObservation,
  observationId,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

/** Every write goes through the loaded policy's allowlist (SEC-V1). */
const upsert = (target: LedgerDb, input: ObservationInput) =>
  upsertObservation(target, input, DEFAULT_POLICY);

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('observations'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

describe('upsertObservation', () => {
  it('inserts a new observation and round-trips the exact domain object', async () => {
    const observation = makeReceiptObservation();
    expect(await upsert(db, observation)).toEqual({ id: observation.id, inserted: true });
    const stored = await getObservation(db, observation.id);
    expect(stored).toEqual(observation);
    for (const field of INDEX_FIELDS.observations) expect(stored).not.toHaveProperty(field);
  });

  it('is a no-op for a duplicate contentHash: returns the first id and never overwrites', async () => {
    const first = makeObservation();
    // The same row seen again later: observedAt is not hashed, so one contentHash and one id (§10 v1.3).
    const duplicate = makeObservation({ observedAt: '2026-10-01T11:00:00-04:00' });
    expect(duplicate.id).toBe(first.id);
    await upsert(db, first);
    expect(await upsert(db, duplicate)).toEqual({ id: first.id, inserted: false });
    expect(await db.observations.count()).toBe(1);
    expect(await getObservation(db, first.id)).toEqual(first);
  });

  it('concurrent upserts of one contentHash insert exactly once (no ConstraintError leaks)', async () => {
    const minutes = [4, 2, 5, 1, 4];
    const seen = (minute: number) =>
      makeObservation({ observedAt: `2026-10-01T10:2${String(minute)}:00-04:00` });
    const settled = await Promise.allSettled(minutes.map((n) => upsert(db, seen(n))));
    expect(await db.observations.count()).toBe(1);
    const stored = await getObservation(db, observationId(1));
    const storedMs = Date.parse(stored?.observedAt ?? '');
    // The first write is kept; a later sighting is a no-op and an earlier one is refused (R3-LEDGER-1).
    const outcomes = settled.map((outcome, i) => {
      const sightedMs = Date.parse(seen(minutes[i] ?? 0).observedAt);
      if (outcome.status === 'rejected') {
        const code: unknown = outcome.reason instanceof LedgerError ? outcome.reason.code : outcome.reason;
        return code === 'late_sighting' && sightedMs < storedMs ? 'refused earlier' : 'bad rejection';
      }
      if (outcome.value.id !== observationId(1)) return 'other id';
      if (outcome.value.inserted) return sightedMs === storedMs ? 'inserted' : 'bad insert';
      return sightedMs >= storedMs ? 'kept' : 'earlier kept silently';
    });
    expect(outcomes.filter((outcome) => outcome === 'inserted')).toHaveLength(1);
    expect(outcomes.every((o) => ['inserted', 'kept', 'refused earlier'].includes(o))).toBe(true);
  });

  it('rejects invalid input with invalid_input and writes nothing', async () => {
    const smuggled = { ...makeObservation(), body: 'full email body' };
    const error = await expectLedgerError(upsert(db, smuggled), 'invalid_input');
    expect(error.context).toMatchObject({ table: 'observations' });
    await expectLedgerError(upsert(db, makeObservation({ contentHash: 'NOT-HEX' })), 'invalid_input');
    await expectLedgerError(
      upsert(db, makeObservation({ occurredAt: '2026-10-01T10:00:00' })),
      'invalid_input',
    );
    expect(await db.observations.count()).toBe(0);
  });
});

describe('upsertObservation: one content, one id (§10 v1.3)', () => {
  it('two contents are two observations with two ids', async () => {
    const other = makeObservation({ subjectHint: 'Other numbers' });
    expect(other.id).not.toBe(observationId(1));
    expect(await upsert(db, makeObservation())).toEqual({ id: observationId(1), inserted: true });
    expect(await upsert(db, other)).toEqual({ id: other.id, inserted: true });
    expect(await upsert(db, makeObservation({ rowKeyHash: sha(2) }))).toEqual({
      id: observationId(2),
      inserted: true,
    });
    expect(await db.observations.count()).toBe(3);
  });

  it('rejects an existing id with a different contentHash as invalid input, keeping the original', async () => {
    // §10 v1.3: the schema requires id = idFromHash(contentHash), so an id can never carry other content.
    const original = makeObservation();
    await upsert(db, original);
    const reused = makeObservation({ id: original.id, contentHash: sha(2) });
    await expectLedgerError(upsert(db, reused), 'invalid_input');
    await expectLedgerError(upsert(db, makeObservation({ id: ulid(1) })), 'invalid_input');
    expect(await getObservation(db, original.id)).toEqual(original);
    expect(await db.observations.count()).toBe(1);
  });
});

describe('a stored observation never moves (§3, R3-LEDGER-1, RP3-3)', () => {
  it('a sighting earlier than the stored one is refused with late_sighting and changes nothing', async () => {
    const late = makeObservation({ observedAt: '2026-10-01T15:00:00-04:00' });
    const early = makeObservation({ observedAt: '2026-10-01T10:20:00-04:00' });
    expect(await upsert(db, late)).toEqual({ id: late.id, inserted: true });
    const error = await expectLedgerError(upsert(db, early), 'late_sighting');
    expect(error.context).toStrictEqual({ table: 'observations', id: late.id });
    expect(await getObservation(db, late.id)).toEqual(late);
    expect(await upsert(db, late)).toEqual({ id: late.id, inserted: false });
    expect(await getObservation(db, late.id)).toEqual(late);
    expect(await db.observations.count()).toBe(1);
  });

  it('a later sighting, or the same instant in another offset, is a no-op', async () => {
    const stored = makeObservation({ observedAt: '2026-10-01T10:20:00-04:00' });
    await upsert(db, stored);
    for (const observedAt of [
      '2026-10-01T14:20:00Z',
      '2026-10-01T10:20:00.001-04:00',
      '2026-10-02T09:00:00Z',
    ]) {
      expect(await upsert(db, makeObservation({ observedAt }))).toEqual({ id: stored.id, inserted: false });
    }
    expect(await getObservation(db, stored.id)).toEqual(stored);
  });

  it('compares instants, not strings: an earlier sighting written in another offset is refused', async () => {
    const late = makeObservation({ observedAt: '2026-10-01T15:00:00-04:00' });
    // 18:00Z is 14:00-04:00: earlier, though it sorts after the stored string.
    await upsert(db, late);
    await expectLedgerError(
      upsert(db, makeObservation({ observedAt: '2026-10-01T18:00:00Z' })),
      'late_sighting',
    );
    expect(await getObservation(db, late.id)).toEqual(late);
  });
});

describe('probe p5: calendar.created and the first sighting (§4.1, OBS-2)', () => {
  it('an event already on the calendar cannot verify "created" from rows written in order', async () => {
    const raw = {
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 sync',
      occurredAt: '2026-10-07T10:00:00-04:00',
    };
    const pass = (observedAt: string) =>
      project('gcal.event', raw, { type: 'calendar.created', observedAt, rowKey: 'evt-1' }, DEFAULT_POLICY);
    await upsert(db, pass('2026-10-06T09:05:00-04:00')); // pass A saw it first, and its write lands first
    expect(await upsert(db, pass('2026-10-06T15:00:00-04:00'))).toMatchObject({ inserted: false });
    const stored = await observationsByTypeAndBuckets(db, 'calendar.created', -1e9, 1e9);
    expect(stored.map((o) => o.observedAt)).toEqual(['2026-10-06T09:05:00-04:00']);
    const rawHash = 'cd'.repeat(32);
    const claim = Claim.parse({
      id: idFromHash(rawHash),
      agent: 'muse',
      type: 'calendar.created',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 sync',
      claimedAt: '2026-10-06T14:58:00-04:00',
      claimedAtPrecision: 'minute',
      targetAt: '2026-10-07T10:00:00-04:00',
      observedAt: '2026-10-06T14:59:00-04:00',
      sourceKind: 'chat',
      extractor: { id: 'muse.chat', version: '1', confidence: 1 },
      rawHash,
    });
    const index = createMemoryIndex(stored, LEDGER_TIME_BUCKET_MINUTES);
    expect(await candidates(claim, index, DEFAULT_POLICY)).toEqual([]);
  });

  it('out of order: the earlier pass that lands second is refused loud, never merged', async () => {
    const raw = { counterparty: 'priya@company.com', occurredAt: '2026-10-07T10:00:00-04:00' };
    const pass = (observedAt: string) =>
      project('gcal.event', raw, { type: 'calendar.created', observedAt, rowKey: 'evt-1' }, DEFAULT_POLICY);
    await upsert(db, pass('2026-10-06T15:00:00-04:00')); // pass B's message lands first
    await expectLedgerError(upsert(db, pass('2026-10-06T09:05:00-04:00')), 'late_sighting');
    const stored = await observationsByTypeAndBuckets(db, 'calendar.created', -1e9, 1e9);
    expect(stored.map((o) => o.observedAt)).toEqual(['2026-10-06T15:00:00-04:00']);
  });
});

describe('upsertObservation: one hash, one fact (OBS-4)', () => {
  it('a stored row edited under its hash is never merged into: the honest sighting fails loud', async () => {
    const honest = makeObservation();
    await upsert(db, honest);
    const row = await db.observations.get(honest.id);
    if (row === undefined) throw new Error('row not stored');
    await db.observations.put({ ...row, subjectHint: 'Edited in place' });
    const error = await expectLedgerError(upsert(db, honest), 'id_conflict');
    expect(error.context).toEqual({ table: 'observations', id: honest.id });
    expect((await getObservation(db, honest.id))?.subjectHint).toBe('Edited in place');
  });
});

describe('getObservation', () => {
  it('returns the stored observation by id', async () => {
    const observation = makeObservation({ source: 'gcal.event', type: 'calendar.created' });
    await upsert(db, observation);
    expect(await getObservation(db, observation.id)).toEqual(observation);
  });

  it('returns undefined for an unknown id', async () => {
    await upsert(db, makeObservation());
    expect(await getObservation(db, ulid(999))).toBeUndefined();
  });
});

describe('observationsByTypeAndBuckets', () => {
  const base = timeBucketOf('2026-10-01T14:00:00Z');

  async function seed(): Promise<ObservationInput[]> {
    const at = (n: number, minutes: number, type: ActionType = 'email.sent'): ObservationInput =>
      makeObservation({
        rowKeyHash: sha(n),
        type,
        occurredAt: new Date(Date.parse('2026-10-01T14:00:00Z') + minutes * 60_000).toISOString(),
      });
    const rows = [at(1, 0), at(2, 60), at(3, 180), at(4, 0, 'calendar.created'), at(5, -60)];
    for (const row of rows) await upsert(db, row);
    return rows;
  }

  it('returns only the given type within the inclusive bucket range', async () => {
    const rows = await seed();
    const found = await observationsByTypeAndBuckets(
      db,
      'email.sent',
      base,
      timeBucketOf(rows[1]?.occurredAt ?? ''),
    );
    expect(found.map((o) => o.id)).toEqual([rows[0]?.id, rows[1]?.id]); // bucket order
    expect(found[0]).toEqual(rows[0]);
    const offsetForm = makeObservation({
      rowKeyHash: sha(6),
      occurredAt: '2026-10-01T19:45:00+05:30',
    });
    await upsert(db, offsetForm);
    // One bucket: ordered by primary key (the id).
    expect((await observationsByTypeAndBuckets(db, 'email.sent', base, base)).map((o) => o.id)).toEqual(
      [rows[0]?.id, offsetForm.id].sort(),
    );
  });

  it('rejects an inverted or non-integer range and an unknown type', async () => {
    await seed();
    await expectLedgerError(observationsByTypeAndBuckets(db, 'email.sent', base + 1, base), 'invalid_input');
    await expectLedgerError(
      observationsByTypeAndBuckets(db, 'email.sent', base, base + 0.5),
      'invalid_input',
    );
    await expectLedgerError(
      observationsByTypeAndBuckets(db, 'email.deleted' as never, base, base),
      'invalid_input',
    );
  });
});
