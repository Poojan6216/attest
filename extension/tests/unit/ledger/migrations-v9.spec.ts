/**
 * Schema v9 (sprint_4 4.6; db.ts STORES_V9): the `alerts` store, keyed by receipt id with `state` indexed. A ledger
 * written at v8 opens at v9 with every row as it was and an empty alerts store: no receipt made FINAL before 4.6 is
 * ever alerted.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STORES_V9, type LedgerDb } from '../../../src/ledger/db';
import { toReceiptRow } from '../../../src/ledger/index-fields';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { getReceipt } from '../../../src/ledger/repo';
import { Receipt } from '../../../src/ledger/types';
import { makeReceipt, openAtVersion, pinClock, releaseClock, ulid, uniqueDbName } from './fixtures';

const opened: LedgerDb[] = [];

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

describe('v8 → v9', () => {
  it('declares v9 after v8: the alerts store, by receipt id, its state indexed', async () => {
    expect(MIGRATIONS.slice(0, 9).map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(MIGRATIONS[8]?.stores).toBe(STORES_V9);
    const db = await openLedger(uniqueDbName('v9'));
    opened.push(db);
    expect(db.alerts.schema.primKey.name).toBe('receiptId');
    expect(db.alerts.schema.indexes.map((index) => index.name)).toEqual(['state']);
  });

  it('upgrades a v8 ledger in place: its receipts as stored, and no alert', async () => {
    const name = uniqueDbName('v8-to-v9');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 8));
    const receipt = Receipt.parse(
      makeReceipt({ id: ulid(1), grade: 'NOT_FOUND', state: 'FINAL', finalAt: '2026-10-01T10:31:00-04:00' }),
    );
    await old.table('receipts').add(toReceiptRow(receipt));
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    expect(db.verno).toBe(MIGRATIONS.at(-1)?.version);
    expect(await getReceipt(db, ulid(1))).toEqual(receipt);
    expect(await db.alerts.count()).toBe(0);
  });
});
