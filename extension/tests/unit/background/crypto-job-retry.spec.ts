import 'fake-indexeddb/auto';
/**
 * A job that stops (tech review TECH-2), on the shared ledger in fake-indexeddb and WXT's fake browser, with the real
 * 600,000 PBKDF2 rounds. A sealed value moved onto another row does not open there, so the passphrase change's job
 * stops on it: the stop is recorded, why as a word, and the options page reads it as stopped, never as progress. The
 * grace alarm's upkeep tries it again while fewer than MAX_JOB_TRIES steps have failed in a row, then leaves it for
 * the person's Try again; once the row is put right, either finishes the job, the record of the failure gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  type CryptoDeps,
  holdKeysHere,
  onCryptoChange,
  onCryptoEnable,
  onCryptoResume,
  resumeCryptoJob,
  resumeStoppedWork,
} from '../../../src/background/crypto';
import { graceUpkeep } from '../../../src/background/alarms';
import { letSleep } from '../../../src/background/keep-awake';
import type { LedgerTable } from '../../../src/bus/messages';
import { DB_NAME } from '../../../src/config';
import { MAX_JOB_TRIES } from '../../../src/config-crypto';
import { clearKeyring } from '../../../src/crypto/keyring';
import { readCryptoState } from '../../../src/ledger/crypto-state';
import { getLedger, putRequest } from '../../../src/ledger/repo';
import { deleteLedger } from '../../../src/ledger/shared';
import { loadCryptoStatus } from '../../../src/ui/settings-data';
import { ledgerIndexedDb, rawPut, rawRows } from '../crypto/raw-store';
import { makeRequest, sha, ulid } from '../ledger/fixtures';

/** Invented only. */
const FIRST = 'an invented passphrase';
const SECOND = 'another invented passphrase';

const notify = vi.fn<(tables: readonly LedgerTable[]) => void>();
const deps: CryptoDeps = { db: getLedger, notify };
const BROKEN = ulid(2);

/** Two sealed requests, the first's sealed value then moved onto the second, where it does not open. */
async function sealedWithOneBroken(): Promise<void> {
  const db = await getLedger();
  await putRequest(db, makeRequest({ id: ulid(1), textHash: sha(1) }));
  await putRequest(db, makeRequest({ id: BROKEN, textHash: sha(2) }));
  expect(await onCryptoEnable({ type: 'crypto.enable', passphrase: FIRST }, deps)).toEqual({ ok: true });
  await resumeCryptoJob(deps);
  const [first, second] = await rawRows(DB_NAME, 'requests', await ledgerIndexedDb());
  if (first === undefined || second === undefined) throw new Error('the requests were not stored');
  await rawPut(DB_NAME, 'requests', { ...second, sealed: first.sealed }, await ledgerIndexedDb());
}

/** Puts the broken row right: gone, as Delete would leave it. */
const repair = async (): Promise<void> => {
  await (await getLedger()).table('requests').where(':id').equals(BROKEN).delete();
};

const state = async () => readCryptoState(await getLedger());

beforeEach(async () => {
  fakeBrowser.reset();
  holdKeysHere();
  await sealedWithOneBroken();
  expect(await onCryptoChange({ type: 'crypto.change', passphrase: FIRST, next: SECOND }, deps)).toEqual({
    ok: true,
  });
  await resumeCryptoJob(deps);
});

afterEach(async () => {
  letSleep();
  await deleteLedger();
  clearKeyring();
});

describe('a job whose step fails', () => {
  it('is recorded as stopped, why as a word, and read as stopped, never as progress', async () => {
    expect(await state()).toMatchObject({ job: 'reseal', jobFailed: 'unreadable', jobTries: 1 });
    expect((await loadCryptoStatus()).job).toMatchObject({ kind: 'reseal', stopped: 'unreadable' });
  });

  it("is tried again at the grace alarm's upkeep", async () => {
    await graceUpkeep();
    expect(await state()).toMatchObject({ job: 'reseal', jobTries: 2 });
  });

  it('is tried again by the grace alarm, and finishes once the row is put right', async () => {
    await resumeStoppedWork(deps);
    expect(await state()).toMatchObject({ jobTries: 2 });
    await repair();
    await resumeStoppedWork(deps);
    const after = await state();
    expect([after.job, after.jobFailed, after.jobTries]).toEqual([undefined, undefined, undefined]);
  });

  it(`is left for the person after ${String(MAX_JOB_TRIES)} failures, and Try again finishes it`, async () => {
    for (let i = 0; i < MAX_JOB_TRIES + 2; i += 1) await resumeStoppedWork(deps);
    expect(await state()).toMatchObject({ job: 'reseal', jobFailed: 'unreadable', jobTries: MAX_JOB_TRIES });
    await repair();
    await resumeStoppedWork(deps);
    expect((await state()).job).toBe('reseal');

    expect(await onCryptoResume(deps)).toEqual({ ok: true });
    await resumeCryptoJob(deps);
    const after = await state();
    expect([after.job, after.jobFailed, after.jobTries]).toEqual([undefined, undefined, undefined]);
  });
});
