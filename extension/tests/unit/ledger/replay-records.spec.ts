import 'fake-indexeddb/auto';
/**
 * The replay records (sprint_3 3.13; src/ledger/replay-records.ts; docs/grading.md §9): each receipt's inputs by its
 * `inputsHash` and each policy document by its `policyHash`, stored by a grading batch, exported as the two maps the
 * `pnpm attest replay` input holds, and purged with their receipts. Schema v5 adds both stores to an older ledger
 * with every row it held intact.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT, loadPolicy } from '../../../src/core/policy';
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
    await putReceiptInputs(db, sha(2), inputs());
    await putReceiptInputs(db, sha(1), inputs('2026-10-08T15:05:00-04:00'));
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    const records = await replayRecords(db);
    expect(Object.keys(records.receiptInputs)).toEqual([sha(1), sha(2)]);
    expect(records.receiptInputs[sha(2)]).toEqual(inputs());
    expect(Object.keys(records.policies)).toEqual([DEFAULT_POLICY.policyHash]);
    expect(loadPolicy(records.policies[DEFAULT_POLICY.policyHash]).policyHash).toBe(
      DEFAULT_POLICY.policyHash,
    );
    await deleteReceiptInputs(db, [sha(2)]);
    expect(Object.keys((await replayRecords(db)).receiptInputs)).toEqual([sha(1)]);
  });

  it('refuses inputs that fail their schema, and a document that does not hash to its policy', async () => {
    const db = await open('replay-refusals');
    await expectLedgerError(putReceiptInputs(db, 'not-a-hash', inputs()), 'invalid_input');
    await expectLedgerError(
      putReceiptInputs(db, sha(3), { ...inputs(), context: { priorSpendCents: -1 } }),
      'invalid_input',
    );
    const other = { ...(DEFAULT_POLICY_DOCUMENT as Record<string, unknown>), version: 99 };
    await expect(putPolicyDocument(db, DEFAULT_POLICY, other)).rejects.toThrow();
    expect(await db.policies.count()).toBe(0);
  });
});

describe('replay records in an export and in the purge', () => {
  it('makes an export the replay input: both maps beside the tables, as `pnpm attest replay` parses it', async () => {
    const db = await open('replay-export');
    await putReceiptInputs(db, sha(7), inputs());
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    const exported = await exportLedger(db, { exportedAt: '2026-10-08T16:00:00-04:00' });
    const replayInput = ReplayExport.parse(JSON.parse(JSON.stringify(exported)));
    expect(Object.keys(replayInput.receiptInputs)).toEqual([sha(7)]);
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
    await putReceiptInputs(db, sha(31), inputs());
    await putReceiptInputs(db, sha(32), inputs());
    await putPolicyDocument(db, DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT);
    const report = await purgeExpired(db, { now: '2026-10-08T12:00:00Z' });
    expect(await getReceipt(db, Receipt.parse(old).id)).toBeUndefined();
    expect([report.receiptInputs, report.policies]).toEqual([1, 0]);
    expect(Object.keys((await replayRecords(db)).receiptInputs)).toEqual([sha(32)]);
    await db.receipts.clear();
    const last = await purgeExpired(db, { now: '2026-10-08T12:00:00Z' });
    expect([last.receiptInputs, last.policies]).toEqual([0, 0]);
    await deleteReceiptInputs(db, [sha(32)]);
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
    expect(db.verno).toBe(5);
    expect(await getReceipt(db, Receipt.parse(makeReceipt()).id)).toEqual(Receipt.parse(makeReceipt()));
    expect([await db.receiptInputs.count(), await db.policies.count()]).toEqual([0, 0]);
    expect(db.table('receiptInputs').schema.indexes.map((index) => index.name)).toEqual(['policyHash']);
  });
});
