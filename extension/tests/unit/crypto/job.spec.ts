import 'fake-indexeddb/auto';
/**
 * The job that rewrites every sealed table (src/ledger/crypto-job.ts; sprint_6 6.5 "re-encrypts in a resumable job"),
 * over more rows than one step takes (SEAL_JOB_PAGE): each step seals one page in one transaction and writes its place
 * beside it, so the next step, after a stop of the worker or not, starts where the last one ended; a place that does
 * not parse starts its table again rather than skip rows; a row that does not open fails its step whole and leaves the
 * place where it was; and the last step clears the job, every row sealed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LEDGER_KDF_ITERATIONS, SEAL_JOB_PAGE, SEALED_TABLES } from '../../../src/config-crypto';
import { clearKeyring, setKeyring } from '../../../src/crypto/keyring';
import type { LedgerKey } from '../../../src/crypto/kdf';
import { isSealed } from '../../../src/crypto/seal';
import { stepCryptoJob } from '../../../src/ledger/crypto-job';
import { CRYPTO_KEYS, readCryptoState } from '../../../src/ledger/crypto-state';
import { beginSealing } from '../../../src/ledger/crypto-writes';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { putRequest, setMeta } from '../../../src/ledger/repo';
import { expectLedgerError, makeRequest, sha, ulid, uniqueDbName } from '../ledger/fixtures';
import { rawPut, rawRows } from './raw-store';

const KEY: LedgerKey = { id: 'aaaaaaaaaaaa', bytes: Uint8Array.from({ length: 32 }, (_, i) => i + 7) };
/** More requests than two steps take, so the job pages twice in the table and once more for the rest. */
const REQUESTS = SEAL_JOB_PAGE * 2 + 50;

let name: string;
let db: LedgerDb;

async function sealedCount(store: string): Promise<number> {
  return (await rawRows(name, store)).filter((row) => isSealed(row.sealed)).length;
}

beforeEach(async () => {
  name = uniqueDbName('crypto-job');
  db = await openLedger(name);
  for (let n = 1; n <= REQUESTS; n += 1) {
    await putRequest(db, makeRequest({ id: ulid(1000 + n), textHash: sha(1000 + n) }));
  }
  await beginSealing(db, {
    keyId: KEY.id,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: LEDGER_KDF_ITERATIONS,
    check: 'not.used',
  });
  setKeyring({ sealing: true, guarded: true, current: KEY });
});

afterEach(() => {
  db.close();
  clearKeyring();
});

describe('the sealing job, a page at a time', () => {
  it('seals one page per step, its place beside it, and resumes from that place', async () => {
    expect(await stepCryptoJob(db)).toEqual({ done: false, table: 'requests' });
    expect(await sealedCount('requests')).toBe(SEAL_JOB_PAGE);
    const place = (await readCryptoState(db)).jobAfter;
    expect(place).toBe(JSON.stringify(ulid(1000 + SEAL_JOB_PAGE)));
    // As after a stop of the worker: the next step reads its place from the ledger alone.
    expect(await stepCryptoJob(db)).toEqual({ done: false, table: 'requests' });
    expect(await sealedCount('requests')).toBe(SEAL_JOB_PAGE * 2);
    expect(await stepCryptoJob(db)).toEqual({ done: false, table: SEALED_TABLES[1] });
    expect(await sealedCount('requests')).toBe(REQUESTS);
    expect((await readCryptoState(db)).jobAfter).toBeUndefined();
  });

  it('runs to the end in as many steps as its pages, then clears the job', async () => {
    let steps = 0;
    for (
      let step = await stepCryptoJob(db);
      step !== undefined && !step.done;
      step = await stepCryptoJob(db)
    ) {
      steps += 1;
    }
    // Three pages of requests, then one step for each other table, the last of which finishes the job.
    expect(steps).toBe(3 + SEALED_TABLES.length - 2);
    expect(await sealedCount('requests')).toBe(REQUESTS);
    const state = await readCryptoState(db);
    expect([state.on, state.job, state.jobTable]).toEqual([true, undefined, undefined]);
    expect(await stepCryptoJob(db)).toBeUndefined();
  });

  it('starts its table again when its place does not parse, never skipping a row', async () => {
    await stepCryptoJob(db);
    await setMeta(db, CRYPTO_KEYS.JOB_AFTER, 'not a key');
    expect(await stepCryptoJob(db)).toEqual({ done: false, table: 'requests' });
    expect((await readCryptoState(db)).jobAfter).toBe(JSON.stringify(ulid(1000 + SEAL_JOB_PAGE)));
  });

  it('fails a step whole on a row that does not open, its place unchanged', async () => {
    await stepCryptoJob(db);
    const placeBefore = await readCryptoState(db);
    const rows = await rawRows(name, 'requests');
    const sealedRow = rows.find((row) => isSealed(row.sealed));
    const next = rows.find((row) => row.id === ulid(1000 + SEAL_JOB_PAGE + 1));
    if (sealedRow === undefined || next === undefined) throw new Error('the first page was not sealed');
    // A sealed value moved onto the next row the job will read: it does not open there.
    await rawPut(name, 'requests', { ...next, sealed: sealedRow.sealed });
    await expectLedgerError(stepCryptoJob(db), 'unreadable');
    expect(await readCryptoState(db)).toEqual(placeBefore);
    expect(await sealedCount('requests')).toBe(SEAL_JOB_PAGE + 1);
  });
});
