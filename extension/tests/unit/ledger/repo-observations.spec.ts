import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { INDEX_FIELDS, timeBucketOf } from '../../../src/ledger/index-fields';
import { openLedger } from '../../../src/ledger/migrations';
import {
  getObservation,
  observationsByCounterpartyToken,
  observationsByTypeAndBuckets,
  upsertObservation,
} from '../../../src/ledger/repo';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { ActionType, ObservationInput } from '../../../src/ledger/types';
import {
  expectLedgerError,
  makeObservation,
  makeReceiptObservation,
  observationId,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

/** Every write goes through the loaded policy's allowlist (SEC-V1). */
const upsert = (target: LedgerDb, input: ObservationInput) =>
  upsertObservation(target, input, DEFAULT_POLICY);

let db: LedgerDb;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('observations'));
});

afterEach(() => {
  db.close();
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
    const seen = (minute: number) =>
      makeObservation({ observedAt: `2026-10-01T10:2${String(minute)}:00-04:00` });
    const results = await Promise.all([1, 2, 3, 4].map((n) => upsert(db, seen(n))));
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await db.observations.count()).toBe(1);
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

describe('observationsByCounterpartyToken', () => {
  it('finds by email, email domain, and merchant, case- and space-insensitively', async () => {
    const email = makeObservation({ counterparty: 'Alice@Example.com' });
    const merchantOnly = makeReceiptObservation({ merchant: 'Blue Bottle', amountCents: 650 });
    await upsert(db, email);
    await upsert(db, merchantOnly);
    expect(await observationsByCounterpartyToken(db, '  ALICE@example.COM ')).toEqual([email]);
    expect(await observationsByCounterpartyToken(db, 'example.com')).toEqual([email]);
    expect(await observationsByCounterpartyToken(db, 'blue bottle')).toEqual([merchantOnly]);
  });

  it('returns nothing for an unknown token and rejects an empty one', async () => {
    await upsert(db, makeObservation());
    expect(await observationsByCounterpartyToken(db, 'bob@example.org')).toEqual([]);
    await expectLedgerError(observationsByCounterpartyToken(db, '   '), 'invalid_input');
  });
});
