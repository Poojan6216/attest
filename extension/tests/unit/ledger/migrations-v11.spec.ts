/**
 * Schema v11 (sprint_5 5.4; db.ts STORES_V11): the `modelAnswers` store, keyed by the claim's id, with `inputsHash`
 * indexed. A ledger written at v10 opens at v11 with every row as it was, its digests included, and no model answer:
 * no model was asked before 5.4. Every value is invented.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildDigest } from '../../../src/ledger/digest';
import { lastWeek } from '../../../src/ledger/digest-week';
import { STORES_V11, type LedgerDb } from '../../../src/ledger/db';
import { toReceiptRow } from '../../../src/ledger/index-fields';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { getReceipt } from '../../../src/ledger/repo';
import { IsoTs, Receipt } from '../../../src/ledger/types';
import { makeReceipt, openAtVersion, pinClock, releaseClock, ulid, uniqueDbName } from './fixtures';

const opened: LedgerDb[] = [];

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

describe('v10 → v11', () => {
  it('declares v11 after v10: the model answers store, by claim, with the inputs hash indexed', async () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(MIGRATIONS[10]?.stores).toBe(STORES_V11);
    const db = await openLedger(uniqueDbName('v11'));
    opened.push(db);
    expect(db.modelAnswers.schema.primKey.name).toBe('claimId');
    expect(db.modelAnswers.schema.indexes.map((index) => index.name)).toEqual(['inputsHash']);
  });

  it('upgrades a v10 ledger in place: its receipts and digests as stored, and no model answer', async () => {
    const name = uniqueDbName('v10-to-v11');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 10));
    const receipt = Receipt.parse(makeReceipt({ id: ulid(1) }));
    await old.table('receipts').add(toReceiptRow(receipt));
    const digest = await buildDigest(old, lastWeek(Date.now()), IsoTs.parse('2026-10-05T09:00:00-04:00'));
    await old.table('digests').add(digest);
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    expect(db.verno).toBe(11);
    expect(await getReceipt(db, ulid(1))).toEqual(receipt);
    expect(await db.digests.toArray()).toEqual([digest]);
    expect(await db.modelAnswers.count()).toBe(0);
  });
});
