import 'fake-indexeddb/auto';
/**
 * The replay records (sprint_3 3.13; src/ledger/replay-records.ts; docs/grading.md §9): each receipt's inputs by its
 * `inputsHash`, each batch's coverage once by its `coverageHash` (schema v7, tech review TECH-1) and each policy
 * document by its `policyHash`, stored by a grading batch, exported as the three maps the `pnpm attest replay` input
 * holds, and purged with their receipts. Schema v5 adds the stores to an older ledger with every row it held intact,
 * and v7 moves each stored copy of a coverage into its own store.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT, loadPolicy } from '../../../src/core/policy';
import { coverageHash } from '../../../src/core/receipt';
import type { LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import {
  deleteReceiptInputs,
  putPolicyDocument,
  putReceiptInputs,
  replayRecords,
} from '../../../src/ledger/replay-records';
import { getReceipt, putReceipt } from '../../../src/ledger/repo';
import { purgeExpired } from '../../../src/ledger/retention';
import { Coverage, Grant, Receipt } from '../../../src/ledger/types';
import { ReplayExport } from '../../tools/attest-snapshot';
import {
  expectLedgerError,
  makeGrant,
  makeReceipt,
  openAtVersion,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

const opened: LedgerDb[] = [];

async function open(prefix: string): Promise<LedgerDb> {
  const db = await openLedger(uniqueDbName(prefix));
  opened.push(db);
  return db;
}

beforeEach(() => {
  pinClock();
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  releaseClock();
});

const inputs = (evaluatedAt = '2026-10-08T15:00:00-04:00') => ({
  coverage: Coverage.parse({ evaluatedAt, observers: [] }),
  grant: Grant.parse(makeGrant()),
  context: { priorSpendCents: 0 },
  policyHash: DEFAULT_POLICY.policyHash,
});

describe('replay records', () => {
  it('stores inputs by inputsHash and a policy document once, and exports both maps with sorted keys', async () => {
    const db = await open('replay-records');
    await putReceiptInputs(db, new Map([[sha(2), inputs()]]));
    await putReceiptInputs(db, new Map([[sha(1), inputs('2026-10-08T15:05:00-04:00')]]));
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    const records = await replayRecords(db);
    expect(Object.keys(records.receiptInputs)).toEqual([sha(1), sha(2)]);
    const { coverage, ...rest } = inputs();
    const hash = coverageHash(coverage);
    expect(records.receiptInputs[sha(2)]).toEqual({ coverageHash: hash, ...rest });
    expect(records.batchCoverages[hash]).toEqual(coverage);
    expect(Object.keys(records.batchCoverages)).toHaveLength(2);
    expect(Object.keys(records.policies)).toEqual([DEFAULT_POLICY.policyHash]);
    expect(loadPolicy(records.policies[DEFAULT_POLICY.policyHash]).policyHash).toBe(
      DEFAULT_POLICY.policyHash,
    );
    await deleteReceiptInputs(db, [sha(2)]);
    const after = await replayRecords(db);
    expect(Object.keys(after.receiptInputs)).toEqual([sha(1)]);
    expect(Object.keys(after.batchCoverages)).not.toContain(hash);
  });

  it('stores the coverage every receipt of a batch shares once, and releases it with the last input naming it', async () => {
    const db = await open('replay-shared-coverage');
    const shared = inputs();
    await putReceiptInputs(
      db,
      new Map([
        [sha(11), shared],
        [sha(12), { ...shared, context: { priorSpendCents: 500 } }],
        [sha(13), shared],
      ]),
    );
    expect([await db.receiptInputs.count(), await db.batchCoverages.count()]).toEqual([3, 1]);
    const hash = coverageHash(shared.coverage);
    expect((await db.receiptInputs.toArray()).every((row) => row.coverageHash === hash)).toBe(true);
    await deleteReceiptInputs(db, [sha(11), sha(12)]);
    expect(await db.batchCoverages.count()).toBe(1);
    await deleteReceiptInputs(db, [sha(13)]);
    expect(await db.batchCoverages.count()).toBe(0);
  });

  it('refuses inputs that fail their schema, and a document that does not hash to its policy', async () => {
    const db = await open('replay-refusals');
    await expectLedgerError(putReceiptInputs(db, new Map([['not-a-hash', inputs()]])), 'invalid_input');
    await expectLedgerError(
      putReceiptInputs(db, new Map([[sha(3), { ...inputs(), context: { priorSpendCents: -1 } }]])),
      'invalid_input',
    );
    const other = { ...(DEFAULT_POLICY_DOCUMENT as Record<string, unknown>), version: 99 };
    await expect(putPolicyDocument(db, DEFAULT_POLICY, other)).rejects.toThrow();
    expect(await db.policies.count()).toBe(0);
  });
});

describe('the export grows with batches, not with receipts (TECH-1)', () => {
  /** A batch coverage of 200 Calendar first-look markers (points) in one week, as tech review probe B measured. */
  const markers = (evaluatedAt: string) =>
    Coverage.parse({
      evaluatedAt,
      observers: Array.from({ length: 200 }, (_, i) => {
        const at = new Date(Date.parse('2026-10-04T08:00:00-04:00') + i * 45 * 60_000).toISOString();
        return {
          observerId: 'gcal.event',
          source: 'gcal.event',
          lastSyncAt: at,
          windowStart: at,
          windowEnd: at,
          accountHash: sha(90),
          allCalendars: true,
          changesSince: at,
        };
      }),
    });

  it('three batches of twenty receipts store three coverages, and the export holds each once', async () => {
    const db = await open('replay-size');
    const batches = ['2026-10-08T15:00:00-04:00', '2026-10-08T15:05:00-04:00', '2026-10-08T15:10:00-04:00'];
    for (const [b, evaluatedAt] of batches.entries()) {
      const coverage = markers(evaluatedAt);
      const entries = Array.from(
        { length: 20 },
        (_, r) => [sha(100 + b * 20 + r), { ...inputs(), coverage }] as const,
      );
      await putReceiptInputs(db, new Map(entries));
    }
    expect([await db.receiptInputs.count(), await db.batchCoverages.count()]).toEqual([60, 3]);
    const one = JSON.stringify(markers(batches[0] ?? '')).length;
    const exported = JSON.stringify(await exportLedger(db, { exportedAt: '2026-10-08T16:00:00-04:00' }));
    // Each receipt's inputs are a few hundred bytes beside the shared coverage; sixty copies would be 60 × `one`.
    expect(exported.length).toBeLessThan(3 * one + 60 * 2_000);
  });
});

describe('replay records in an export and in the purge', () => {
  it('makes an export the replay input: both maps beside the tables, as `pnpm attest replay` parses it', async () => {
    const db = await open('replay-export');
    await putReceiptInputs(db, new Map([[sha(7), inputs()]]));
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    const exported = await exportLedger(db, { exportedAt: '2026-10-08T16:00:00-04:00' });
    const replayInput = ReplayExport.parse(JSON.parse(JSON.stringify(exported)));
    expect(Object.keys(replayInput.receiptInputs)).toEqual([sha(7)]);
    expect(Object.keys(replayInput.batchCoverages)).toEqual([coverageHash(inputs().coverage)]);
    expect(Object.keys(replayInput.policies)).toEqual([DEFAULT_POLICY.policyHash]);
  });

  it('are purged with their receipts, and a policy document with the last input that names it', async () => {
    const db = await open('replay-purge');
    const old = makeReceipt({ id: ulid(301), inputsHash: sha(31), computedAt: '2026-06-01T12:00:00Z' });
    const kept = makeReceipt({
      id: ulid(302),
      claimId: undefined,
      requestId: undefined,
      inputsHash: sha(32),
      computedAt: '2026-10-07T12:00:00Z',
    });
    await putReceipt(db, old);
    await putReceipt(db, kept);
    await putReceiptInputs(db, new Map([[sha(31), inputs()]]));
    await putReceiptInputs(db, new Map([[sha(32), inputs()]]));
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    const report = await purgeExpired(db, { now: '2026-10-08T12:00:00Z' });
    expect(await getReceipt(db, Receipt.parse(old).id)).toBeUndefined();
    // The kept receipt's inputs still name the coverage both shared, so it stays.
    expect([report.receiptInputs, report.policies, report.batchCoverages]).toEqual([1, 0, 0]);
    expect(Object.keys((await replayRecords(db)).receiptInputs)).toEqual([sha(32)]);
    expect(await db.batchCoverages.count()).toBe(1);
    await db.receipts.clear();
    const last = await purgeExpired(db, { now: '2026-10-08T12:00:00Z' });
    expect([last.receiptInputs, last.policies, last.batchCoverages]).toEqual([0, 0, 0]);
    await deleteReceiptInputs(db, [sha(32)]);
    expect(await db.batchCoverages.count()).toBe(0);
    expect((await purgeExpired(db, { now: '2026-10-08T12:00:00Z' })).policies).toBe(1);
    expect(await db.policies.count()).toBe(0);
  });
});

describe('v4 → v5', () => {
  it('adds the two stores, empty, to a v4 ledger, whose rows read as before', async () => {
    const name = uniqueDbName('v4-to-v5');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 4));
    expect(old.verno).toBe(4);
    await putReceipt(old, makeReceipt());
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    expect(db.verno).toBe(MIGRATIONS.at(-1)?.version); // v5, v6's activity store, v7's batch coverages
    expect(await getReceipt(db, Receipt.parse(makeReceipt()).id)).toEqual(Receipt.parse(makeReceipt()));
    expect([await db.receiptInputs.count(), await db.policies.count()]).toEqual([0, 0]);
    expect(db.table('receiptInputs').schema.indexes.map((index) => index.name)).toEqual([
      'policyHash',
      'coverageHash',
    ]);
  });
});

describe('v6 → v7', () => {
  it('moves every stored copy of a coverage into batchCoverages, once, and names it by hash', async () => {
    const name = uniqueDbName('v6-to-v7');
    const old = await openAtVersion(name, MIGRATIONS.slice(0, 6));
    expect(old.verno).toBe(6);
    const { coverage, grant, context, policyHash } = inputs();
    for (const inputsHash of [sha(41), sha(42)]) {
      await old.table('receiptInputs').put({ inputsHash, coverage, grant, context, policyHash });
    }
    await old.table('receiptInputs').put({ inputsHash: sha(43), coverage: { observers: 'unreadable' } });
    old.close();
    const db = await openLedger(name);
    opened.push(db);
    expect(db.verno).toBe(7);
    const hash = coverageHash(coverage);
    const records = await replayRecords(db);
    expect(Object.keys(records.receiptInputs)).toEqual([sha(41), sha(42)]);
    expect(records.receiptInputs[sha(42)]).toEqual({ coverageHash: hash, grant, context, policyHash });
    expect(records.batchCoverages).toEqual({ [hash]: coverage });
    // A row whose coverage did not parse is left as it was: the strict read skips it, as before.
    expect(await db.receiptInputs.count()).toBe(3);
  });
});
