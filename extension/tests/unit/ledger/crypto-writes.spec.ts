import 'fake-indexeddb/auto';
/**
 * The ledger's encryption state, written by the service worker only (src/ledger/crypto-writes.ts; sprint_6 6.5): each
 * change writes exactly its keys of `meta` in one transaction, each value one `meta` takes; a new start clears the place
 * and the key before of any job left; and finishing a job clears only that job, or every `crypto.` key once encryption
 * is off. Every value here is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CRYPTO_PREFIX, readCryptoState } from '../../../src/ledger/crypto-state';
import { beginResealing, beginSealing, beginUnsealing, finishJob } from '../../../src/ledger/crypto-writes';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { setMeta } from '../../../src/ledger/repo';
import { uniqueDbName } from './fixtures';

const FIRST = {
  keyId: '0123456789ab',
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iterations: 600_000,
  check: 'iv.ct',
};
const NEXT = {
  keyId: 'ba9876543210',
  salt: 'BBBBBBBBBBBBBBBBBBBBBB==',
  iterations: 600_000,
  check: 'iv2.ct2',
};

let db: LedgerDb;
const cryptoKeys = async () => (await db.meta.where('key').startsWith(CRYPTO_PREFIX).primaryKeys()).sort();

beforeEach(async () => {
  db = await openLedger(uniqueDbName('crypto-writes'));
});

afterEach(() => {
  db.close();
});

describe('the encryption state', () => {
  it('turned on: the key, its salt, rounds and check, and a seal job from the first table', async () => {
    await beginSealing(db, FIRST);
    expect(await readCryptoState(db)).toEqual({
      on: true,
      ...FIRST,
      job: 'seal',
      jobTable: 'requests',
    });
  });

  it('a new passphrase: the new key, the key before, and a reseal job from the start, whatever place was left', async () => {
    await beginSealing(db, FIRST);
    await setMeta(db, 'crypto.jobAfter', '"some-id"');
    await beginResealing(db, NEXT, 'aaaaaaaaaaaa.iv.ct');
    expect(await readCryptoState(db)).toEqual({
      on: true,
      ...NEXT,
      previous: 'aaaaaaaaaaaa.iv.ct',
      job: 'reseal',
      jobTable: 'requests',
    });
  });

  it('turning off: an unseal job, the key kept until it ends', async () => {
    await beginSealing(db, FIRST);
    await finishJob(db, 'seal');
    await beginUnsealing(db);
    expect(await readCryptoState(db)).toEqual({ on: true, ...FIRST, job: 'unseal', jobTable: 'requests' });
  });

  it('a job done: only that job and the key before go, and the rebuild is due; once off, every crypto key goes, and nothing else', async () => {
    await setMeta(db, 'retentionDays', 90);
    await beginSealing(db, FIRST);
    await beginResealing(db, NEXT, 'aaaaaaaaaaaa.iv.ct');
    await finishJob(db, 'reseal');
    expect(await readCryptoState(db)).toEqual({ on: true, ...NEXT, rebuild: true });
    await beginUnsealing(db);
    await finishJob(db, 'unseal');
    expect(await cryptoKeys()).toEqual([]);
    expect(await db.meta.get('retentionDays')).toEqual({ key: 'retentionDays', value: 90 });
  });
});
