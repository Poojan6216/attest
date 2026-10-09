/**
 * Schema v8 (sprint_4 4.0; db.ts STORES_V8): receipts gain the derived `computedMs` (`computedAt` in epoch ms) and the
 * `[agent+computedMs]` index the UI's pages read through (src/ledger/views.ts). A ledger written at v7 opens at v8 with
 * every receipt intact: each listed by the new index, read back exactly as stored, and paged newest first. A row whose
 * `computedAt` does not parse is left as it was: the strict read still skips it, and no index lists it.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STORES_V8, type LedgerDb } from '../../../src/ledger/db';
import { INDEX_FIELDS, toReceiptRow } from '../../../src/ledger/index-fields';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { getReceipt } from '../../../src/ledger/repo';
import { Receipt } from '../../../src/ledger/types';
import { receiptPage } from '../../../src/ledger/views';
import {
  claimId,
  makeReceipt,
  omit,
  openAtVersion,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

const opened: LedgerDb[] = [];

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

/** Receipt `n` as the v7 code stored it: the receipt and its `date`, no `computedMs`. */
function v7Row(n: number, computedAt: string) {
  const receipt = Receipt.parse(
    makeReceipt({ id: ulid(n), claimId: claimId(n), inputsHash: sha(n), computedAt }),
  );
  return omit(toReceiptRow(receipt), 'computedMs');
}

describe('v7 → v8', () => {
  it('declares v8 after v7: receipts indexed by agent and grading instant', async () => {
    expect(MIGRATIONS.slice(0, 8).map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(MIGRATIONS[7]?.stores).toBe(STORES_V8);
    expect(INDEX_FIELDS.receipts).toEqual(['date', 'computedMs']);
    const db = await openLedger(uniqueDbName('v8'));
    opened.push(db);
    const names = db.receipts.schema.indexes.map((index) => index.name);
    expect(names).toEqual(
      expect.arrayContaining(['[agent+computedMs]', '[agent+grade+computedMs]', '[agent+date]', 'grade']),
    );
  });

  it('upgrades a v7 ledger in place: each receipt gets its grading instant, and the pages list it', async () => {
    const name = uniqueDbName('v7-to-v8');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 7));
    const early = v7Row(1, '2026-10-01T10:31:00-04:00');
    const late = v7Row(2, '2026-10-01T16:00:00Z');
    // A row the strict read already skipped: its grading instant does not parse.
    const broken = { ...v7Row(3, '2026-10-01T10:31:00-04:00'), computedAt: 'not an instant' };
    await old.table('receipts').bulkAdd([early, late, broken]);
    old.close();

    const db = await openLedger(name);
    opened.push(db);
    expect(db.verno).toBe(MIGRATIONS.at(-1)?.version);
    const stored = await db.table('receipts').toArray();
    expect(stored).toEqual([
      { ...early, computedMs: Date.parse('2026-10-01T14:31:00Z') },
      { ...late, computedMs: Date.parse('2026-10-01T16:00:00Z') },
      broken,
    ]);
    expect(await getReceipt(db, ulid(1))).toEqual(
      Receipt.parse(makeReceipt({ id: ulid(1), claimId: claimId(1), inputsHash: sha(1) })),
    );
    expect(await getReceipt(db, ulid(3))).toBeUndefined();
    const page = await receiptPage(db, {
      agents: ['muse'],
      fromMs: Date.parse('2026-10-01T00:00:00Z'),
      toMs: Date.parse('2026-10-02T00:00:00Z'),
      limit: 10,
    });
    expect(page.items.map(({ receipt }) => receipt.id)).toEqual([ulid(2), ulid(1)]);
  });
});
