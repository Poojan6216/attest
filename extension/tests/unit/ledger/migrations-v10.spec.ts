/**
 * Schema v10 (sprint_4 4.7; db.ts STORES_V10): the `digests` store, keyed by the week's Monday. A ledger written at v9
 * opens at v10 with every row as it was, its alerts included, and no digest: the first is made by the next Monday's
 * alarm. Written by the Sprint 4 QA review, as tests/unit/ledger/migrations-v9.spec.ts is for v9.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STORES_V10, type LedgerDb } from '../../../src/ledger/db';
import { toReceiptRow } from '../../../src/ledger/index-fields';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { getReceipt } from '../../../src/ledger/repo';
import { AlertRecord, Receipt } from '../../../src/ledger/types';
import { makeReceipt, openAtVersion, pinClock, releaseClock, ulid, uniqueDbName } from './fixtures';

const opened: LedgerDb[] = [];

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

describe('v9 → v10', () => {
  it('declares v10 after v9: the digests store, by week, with no other index', async () => {
    expect(MIGRATIONS.slice(0, 10).map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(MIGRATIONS[9]?.stores).toBe(STORES_V10);
    const db = await openLedger(uniqueDbName('v10'));
    opened.push(db);
    expect(db.digests.schema.primKey.name).toBe('week');
    expect(db.digests.schema.indexes).toEqual([]);
  });

  it('upgrades a v9 ledger in place: its receipts and alerts as stored, and no digest', async () => {
    const name = uniqueDbName('v9-to-v10');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 9));
    const finalAt = '2026-10-01T10:31:00-04:00';
    const receipt = Receipt.parse(makeReceipt({ id: ulid(1), grade: 'NOT_FOUND', state: 'FINAL', finalAt }));
    const alert = AlertRecord.parse({
      receiptId: ulid(1),
      agent: 'muse',
      grade: 'NOT_FOUND',
      state: 'shown',
      finalAt,
      handledAt: '2026-10-01T10:36:00-04:00',
    });
    await old.table('receipts').add(toReceiptRow(receipt));
    await old.table('alerts').add(alert);
    old.close();
    // At v10 itself: the shipped ledger is later (./migrations-v11.spec.ts).
    const db = await openAtVersion(name, MIGRATIONS.slice(0, 10));
    opened.push(db);
    expect(db.verno).toBe(10);
    expect(await getReceipt(db, ulid(1))).toEqual(receipt);
    expect(await db.alerts.toArray()).toEqual([alert]);
    expect(await db.digests.count()).toBe(0);
  });
});
