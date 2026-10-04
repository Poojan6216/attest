/**
 * The ledger's Dexie ObservationIndex (src/ledger/index.ts; docs/grading.md §4.2; Sprint 2.6). The Sprint 1 candidate
 * tests run against it through tests/unit/ledger/index-implementations.ts; this file covers what is the ledger's own:
 *  - a row stored later than it was sighted comes back with its `sightedAt`, from both index implementations, and
 *    the §4.1 calendar first-seen rule reads it (Sprint 1 carry-forward SIM-2);
 *  - rows come back through the row reader: a corrupt row is skipped and logged by id, never returned;
 *  - every read is an indexed `[type+timeBucket]` range, never a table scan, bounded and trimmed to its range;
 *  - bad arguments fail loud.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CandidatesError, candidates, createMemoryIndex } from '../../../src/core/candidates';
import { idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { project } from '../../../src/core/redact';
import { type ActionType, Claim, type Observation, Ulid } from '../../../src/core/schema';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { toObservationRow } from '../../../src/ledger/index-fields';
import { bucketOfMs, createLedgerIndex } from '../../../src/ledger/index';
import { openLedger } from '../../../src/ledger/migrations';
import { getObservation, upsertObservation } from '../../../src/ledger/repo';
import { Observation as ObservationSchema } from '../../../src/ledger/types';
import { captureLogs, expectLedgerError, pinClock, releaseClock, uniqueDbName } from './fixtures';
import { INDEX_IMPLEMENTATIONS } from './index-implementations';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('ledger-index'));
});

afterEach(() => {
  db.close();
  releaseClock();
});

const ms = (iso: string) => Date.parse(iso);

/** A Calendar event for Oct 7 10:00, sighted by the observer at `sightedAt` (redact.project seals it). */
const sighted = (sightedAt: string, rowKey = 'evt-1') =>
  project(
    'gcal.event',
    { counterparty: 'priya@company.com', subjectHint: 'Q3 sync', occurredAt: '2026-10-07T10:00:00-04:00' },
    { type: 'calendar.created', observedAt: sightedAt, rowKey },
    DEFAULT_POLICY,
  );

/** "Created the Q3 sync" claimed at 14:58 (first-seen bound 14:56), for Oct 7 10:00. */
const RAW_HASH = 'cd'.repeat(32);
const CLAIM = Claim.parse({
  id: idFromHash(RAW_HASH),
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
  rawHash: RAW_HASH,
});

/** The event sighted at 09:05, written by the ledger at 15:00 (after the claim): stored with `sightedAt`. */
async function storedLate(): Promise<Observation> {
  const observation = sighted('2026-10-06T09:05:00-04:00');
  pinClock('2026-10-06T15:00:00-04:00');
  await upsertObservation(db, observation, DEFAULT_POLICY);
  const stored = await getObservation(db, observation.id);
  if (stored === undefined) throw new Error('expected the stored event');
  return stored;
}

describe('sightedAt comes back from both index implementations (SIM-2)', () => {
  it('the ledger stores the sighting as sightedAt, and the Dexie index returns the row exactly as stored', async () => {
    const stored = await storedLate();
    expect(stored.sightedAt).toBe('2026-10-06T09:05:00-04:00');
    expect(stored.observedAt).not.toBe(stored.sightedAt);
    const read = await createLedgerIndex(db).byTypeAndBucket(
      'calendar.created',
      ms('2026-10-07T00:00:00-04:00'),
      ms('2026-10-08T00:00:00-04:00'),
    );
    expect(read).toEqual([stored]);
    expect(read[0]?.sightedAt).toBe('2026-10-06T09:05:00-04:00');
  });

  it.each(INDEX_IMPLEMENTATIONS.map((implementation) => [implementation.name, implementation] as const))(
    'the %s index returns a stored row with its sightedAt',
    async (_name, implementation) => {
      const stored = await storedLate();
      const index = implementation.createIndex([stored], 60);
      const read = await index.byTypeAndBucket(
        'calendar.created',
        ms('2026-10-07T09:00:00-04:00'),
        ms('2026-10-07T11:00:00-04:00'),
      );
      expect(read).toEqual([stored]);
      expect(read[0]?.sightedAt).toBe(stored.sightedAt);
    },
  );

  it('an event already on the calendar but stored after the claim is no candidate through the Dexie index', async () => {
    const stored = await storedLate();
    // Rebuilt from its observedAt alone it would pass the first-seen bound and verify "created" (§4.1).
    const rebuilt: Observation = { ...stored, sightedAt: undefined };
    expect(await candidates(CLAIM, createMemoryIndex([rebuilt], 60), DEFAULT_POLICY)).toEqual([rebuilt]);
    expect(await candidates(CLAIM, createLedgerIndex(db), DEFAULT_POLICY)).toEqual([]);
    const memory = createMemoryIndex(
      readRows('observations', ObservationSchema, await db.observations.toArray()),
      60,
    );
    expect(await candidates(CLAIM, memory, DEFAULT_POLICY)).toEqual([]);
  });

  it('an event first sighted after the claim is a candidate through the Dexie index', async () => {
    const fresh = sighted('2026-10-06T15:00:00-04:00', 'evt-2');
    pinClock('2026-10-06T15:00:00-04:00');
    await upsertObservation(db, fresh, DEFAULT_POLICY);
    expect(await candidates(CLAIM, createLedgerIndex(db), DEFAULT_POLICY)).toEqual([fresh]);
  });
});

describe('rows come back through the row reader', () => {
  it('a corrupt row (an id that does not derive from its hash) is skipped and logged by id only', async () => {
    const honest = sighted('2026-10-06T15:00:00-04:00');
    const corrupt = {
      ...sighted('2026-10-06T15:00:00-04:00', 'evt-3'),
      id: Ulid.parse('0' + 'C'.repeat(25)),
    };
    await db.observations.bulkAdd([toObservationRow(honest), toObservationRow(corrupt)]);
    const logs = captureLogs();
    try {
      const read = await createLedgerIndex(db).byTypeAndBucket('calendar.created', -1e12, 1e13);
      expect(read).toEqual([honest]);
    } finally {
      logs.restore();
    }
    const invalid = logs.records.filter((record) => record.event === 'ledger.row_invalid');
    // Logged by its id (a well-formed ULID) and table, never by its content (db.ts readRow).
    expect(invalid.map((record) => [record.fields.table, record.fields.id])).toEqual([
      ['observations', corrupt.id],
    ]);
  });
});

/** One email.sent row every 7 minutes from 08:00Z, written straight into the table as stored rows. */
async function seedRows(count: number): Promise<Observation[]> {
  const rows = Array.from({ length: count }, (_, i) =>
    project(
      'gmail.sent',
      {
        counterparty: 'priya@company.com',
        occurredAt: new Date(ms('2026-10-06T08:00:00Z') + i * 7 * 60_000).toISOString(),
      },
      { type: 'email.sent', observedAt: '2026-10-06T23:00:00Z', rowKey: `row-${String(i)}` },
      DEFAULT_POLICY,
    ),
  );
  await db.observations.bulkAdd(rows.map(toObservationRow));
  return rows;
}

describe('reads are indexed ranges, bounded and exact', () => {
  it('reads through [type+timeBucket] only, never the whole table', async () => {
    await seedRows(40);
    const where = vi.spyOn(db.observations, 'where');
    const toArray = vi.spyOn(db.observations, 'toArray');
    const index = createLedgerIndex(db);
    await index.byTypeAndBucket('email.sent', ms('2026-10-06T09:00:00Z'), ms('2026-10-06T10:00:00Z'));
    await index.byCounterpartyToken('priya', ms('2026-10-06T09:00:00Z'), ms('2026-10-06T10:00:00Z'));
    expect(where.mock.calls.map(([index]) => index)).toEqual(['[type+timeBucket]', '[type+timeBucket]']);
    expect(toArray).not.toHaveBeenCalled();
  });

  it('returns exactly the rows in [fromMs, toMs], ordered by instant, from any bucket alignment', async () => {
    const rows = await seedRows(86);
    const index = createLedgerIndex(db);
    for (const [from, to] of [
      ['2026-10-06T08:07:00Z', '2026-10-06T08:20:59.999Z'],
      ['2026-10-06T10:03:00Z', '2026-10-06T12:41:00Z'],
      ['2026-10-06T08:59:59.999Z', '2026-10-06T09:00:00.000Z'],
    ] as const) {
      const wanted = rows.filter((o) => ms(o.occurredAt) >= ms(from) && ms(o.occurredAt) <= ms(to));
      expect(await index.byTypeAndBucket('email.sent', ms(from), ms(to))).toEqual(wanted);
    }
  });

  it('finds a row whose stored bucket is one off its instant (the read margin), and trims by instant', async () => {
    const [row] = await seedRows(1);
    if (row === undefined) throw new Error('expected a row');
    const at = ms(row.occurredAt);
    await db.observations.clear();
    for (const shift of [-1, 1]) {
      await db.observations.put({ ...toObservationRow(row), timeBucket: bucketOfMs(at) + shift });
      const index = createLedgerIndex(db);
      expect(await index.byTypeAndBucket('email.sent', at, at)).toEqual([row]);
      expect(await index.byTypeAndBucket('email.sent', at + 1, at + 60_000)).toEqual([]);
    }
  });
});

describe('byCounterpartyToken reads every type, in (instant, id) order', () => {
  it('rows of two types at one instant come back by id, not by type', async () => {
    const at = '2026-10-06T14:00:00Z';
    const row = (type: ActionType, n: number) =>
      project(
        'gmail.sent',
        { counterparty: 'priya@company.com', occurredAt: at },
        { type, observedAt: at, rowKey: `k-${String(n)}` },
        DEFAULT_POLICY,
      );
    const purchase = row('purchase.made', 0);
    // The index reads email.sent before purchase.made; an email row whose id sorts after the purchase's.
    const email = Array.from({ length: 40 }, (_, n) => row('email.sent', n + 1)).find(
      (o) => o.id > purchase.id,
    );
    if (email === undefined) throw new Error('expected an id above the purchase id');
    await db.observations.bulkAdd([toObservationRow(purchase), toObservationRow(email)]);
    const read = await createLedgerIndex(db).byCounterpartyToken('company.com', ms(at), ms(at));
    expect(read).toEqual([purchase, email]);
  });
});

describe('token lookups are exact (§4.2)', () => {
  it.each(INDEX_IMPLEMENTATIONS.map((implementation) => [implementation.name, implementation] as const))(
    'the %s index finds a stored token as given, and nothing for another spelling of it',
    async (_name, implementation) => {
      const rows = await seedRows(3);
      const index = implementation.createIndex(rows, 60);
      const [from, to] = [ms('2026-10-06T08:00:00Z'), ms('2026-10-06T09:00:00Z')];
      expect(await index.byCounterpartyToken('priya', from, to)).toEqual(rows);
      for (const other of ['PRIYA', 'Priya', ' priya', 'priya@company.com '])
        expect(await index.byCounterpartyToken(other, from, to)).toEqual([]);
    },
  );
});

describe('bad arguments fail loud', () => {
  it('rejects a bound that is not a safe integer, and an unknown type', async () => {
    const index = createLedgerIndex(db);
    for (const bad of [Number.NaN, 1.5, Number.POSITIVE_INFINITY, 2 ** 53]) {
      await expect(index.byTypeAndBucket('email.sent', bad, 0)).rejects.toThrow(CandidatesError);
      await expect(index.byCounterpartyToken('priya', 0, bad)).rejects.toMatchObject({
        code: 'invalid_range',
      });
    }
    await expectLedgerError(index.byTypeAndBucket('mail.sent' as ActionType, 0, 1), 'invalid_input');
  });

  it('an empty range reads nothing', async () => {
    await seedRows(10);
    const index = createLedgerIndex(db);
    expect(
      await index.byTypeAndBucket('email.sent', ms('2026-10-06T12:00:00Z'), ms('2026-10-06T08:00:00Z')),
    ).toEqual([]);
    expect(await index.byCounterpartyToken('priya', 10, 9)).toEqual([]);
  });
});
