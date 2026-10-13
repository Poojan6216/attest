import 'fake-indexeddb/auto';
/**
 * The ledger's rows sealed at rest (src/crypto/middleware.ts; sprint_6 6.5 "encrypted ledger round-trips and fails
 * closed"), on the real ledger in fake-indexeddb, written and read through the repos:
 *  - with a key held, a content table's row is stored as its keys, its index fields and `sealed`, with no field value
 *    readable in IndexedDB; every read path (by key, by index, by cursor, the export) returns it whole, and an export
 *    is the one an unsealed ledger gives;
 *  - with no key held, every read and write of a content table fails `locked`, whole, a count, a key or an empty
 *    table's included: zero partial reads; the tables without content work as before;
 *  - a changed byte, or a sealed value moved to another row, fails `unreadable`;
 *  - a row written before encryption was on reads as it is, and during a passphrase change the previous key opens
 *    what the new one has not sealed yet.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../../../src/core/policy';
import { loadCipher } from '../../../src/crypto/cipher';
import { clearKeyring, setKeyring, type Keyring } from '../../../src/crypto/keyring';
import type { LedgerKey } from '../../../src/crypto/kdf';
import { isSealed } from '../../../src/crypto/seal';
import type { LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { openLedger } from '../../../src/ledger/migrations';
import {
  claimsByAgentAndDate,
  getAdapterHealth,
  getClaim,
  getGrant,
  getMeta,
  getObservation,
  getReceipt,
  getRequest,
  putAdapterHealth,
  putGrant,
  putReceipt,
  putRequest,
  receiptsByAgentAndDate,
  setMeta,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import {
  expectLedgerError,
  makeClaim,
  makeGrant,
  makeHealth,
  makeObservation,
  makeReceipt,
  makeRequest,
  pinClock,
  releaseClock,
  sha,
  uniqueDbName,
} from '../ledger/fixtures';
import { rawPut, rawRows, textsIn } from './raw-store';

const keyOf = (fill: number, id: string): LedgerKey => ({
  id,
  bytes: Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + fill) % 256),
});
const KEY = keyOf(3, 'aaaaaaaaaaaa');
const NEXT = keyOf(4, 'bbbbbbbbbbbb');
const SEALING: Keyring = { sealing: true, guarded: true, current: KEY };
const LOCKED: Keyring = { sealing: true, guarded: true };
/** The fixtures' invented content, which must never be readable at rest. */
const CONTENT = ['alice@example.com', 'Quarterly numbers', 'Email Alice', 'example.com', 'muse.activity'];
const EXPORTED_AT = '2026-10-02T00:00:00Z';

const CLAIM = makeClaim();
const OBSERVATION = makeObservation();
const REQUEST = makeRequest();
const RECEIPT = makeReceipt();
const GRANT = makeGrant();

let name: string;
let db: LedgerDb;

async function seed(target: LedgerDb): Promise<void> {
  await putRequest(target, REQUEST);
  await upsertClaim(target, CLAIM);
  await upsertObservation(target, OBSERVATION, DEFAULT_POLICY);
  await putReceipt(target, RECEIPT);
  await putGrant(target, GRANT);
}

const keysOf = async (store: string) => (await rawRows(name, store)).map((row) => Object.keys(row).sort());

// As src/ledger/crypto-state.ts `loadKeyring` loads it for a ledger that may hold sealed rows (TECH-1).
beforeAll(loadCipher);

beforeEach(async () => {
  pinClock();
  name = uniqueDbName('sealed');
  db = await openLedger(name);
});

afterEach(() => {
  db.close();
  clearKeyring();
  releaseClock();
});

async function sealAndSeed(): Promise<void> {
  setKeyring(SEALING);
  await seed(db);
}

describe('with the key held: at rest, and read back', () => {
  beforeEach(sealAndSeed);

  it('stores each content row as its keys, its index fields and `sealed`, nothing else in the clear', async () => {
    expect(await keysOf('requests')).toEqual([['agent', 'conversationId', 'date', 'id', 'sealed']]);
    expect(await keysOf('claims')).toEqual([
      ['agent', 'date', 'id', 'rawHash', 'requestId', 'sealed', 'type'],
    ]);
    expect(await keysOf('observations')).toEqual([
      ['contentHash', 'id', 'occurredAt', 'sealed', 'timeBucket', 'type'],
    ]);
    expect(await keysOf('receipts')).toEqual([
      ['agent', 'claimId', 'computedMs', 'date', 'grade', 'id', 'observationIds', 'sealed', 'state'],
    ]);
    expect(await keysOf('grants')).toEqual([['agent', 'sealed']]);
    for (const store of ['requests', 'claims', 'observations', 'receipts', 'grants']) {
      for (const row of await rawRows(name, store)) {
        expect(isSealed(row.sealed), store).toBe(true);
        expect(Reflect.get(row.sealed ?? {}, 'k')).toBe(KEY.id);
        const texts = textsIn(row).join('\n');
        for (const value of CONTENT) expect(texts, `${store}: ${value}`).not.toContain(value);
      }
    }
  });

  it('reads every row back whole, by key, by index and by cursor', async () => {
    expect(await getRequest(db, REQUEST.id)).toEqual(REQUEST);
    expect(await getClaim(db, CLAIM.id)).toMatchObject({
      counterparty: 'alice@example.com',
      rawHash: CLAIM.rawHash,
    });
    expect(await getObservation(db, OBSERVATION.id)).toMatchObject({ subjectHint: 'Quarterly numbers' });
    expect(await getReceipt(db, RECEIPT.id)).toMatchObject({
      reasons: RECEIPT.reasons,
      signals: RECEIPT.signals,
    });
    expect(await getGrant(db, 'muse')).toMatchObject({ counterpartyAllowlist: ['example.com'] });
    expect((await claimsByAgentAndDate(db, 'muse', '2026-10-01')).map((claim) => claim.id)).toEqual([
      CLAIM.id,
    ]);
    expect((await receiptsByAgentAndDate(db, 'muse', '2026-10-01')).map((receipt) => receipt.id)).toEqual([
      RECEIPT.id,
    ]);
    const viaCursor = await db.observations.filter(() => true).toArray();
    expect(viaCursor[0]).toMatchObject({ counterparty: 'alice@example.com' });
    expect(await db.claims.orderBy('type').primaryKeys()).toEqual([CLAIM.id]);
  });
});

describe('with the key held: the export, an update, the tables without content', () => {
  beforeEach(sealAndSeed);

  it('exports what an unsealed ledger exports', async () => {
    const sealed = await exportLedger(db, { exportedAt: EXPORTED_AT });
    clearKeyring();
    const plainDb = await openLedger(uniqueDbName('plain'));
    try {
      await seed(plainDb);
      expect(sealed).toEqual(await exportLedger(plainDb, { exportedAt: EXPORTED_AT }));
    } finally {
      plainDb.close();
    }
  });

  it('keeps a row sealed through an update', async () => {
    await db.receipts.update(RECEIPT.id, { confidence: 0.5 });
    expect(await getReceipt(db, RECEIPT.id)).toMatchObject({ confidence: 0.5 });
    const [row] = await rawRows(name, 'receipts');
    expect(row).not.toHaveProperty('confidence');
    expect(isSealed(row?.sealed)).toBe(true);
  });

  it('leaves the tables without content as they are', async () => {
    await putAdapterHealth(db, makeHealth());
    await setMeta(db, 'retentionDays', 90);
    expect(await keysOf('adapterHealth')).toEqual([
      ['adapterId', 'checkedAt', 'reasons', 'status', 'version'],
    ]);
    expect((await rawRows(name, 'meta')).some((row) => 'sealed' in row)).toBe(false);
  });
});

describe('with no key held (locked)', () => {
  beforeEach(async () => {
    await sealAndSeed();
    setKeyring(LOCKED);
  });

  it('fails every read of a sealed row, whole, and the export', async () => {
    await expectLedgerError(getClaim(db, CLAIM.id), 'locked');
    await expectLedgerError(getRequest(db, REQUEST.id), 'locked');
    await expectLedgerError(claimsByAgentAndDate(db, 'muse', '2026-10-01'), 'locked');
    await expectLedgerError(db.observations.filter(() => true).toArray(), 'locked');
    await expectLedgerError(exportLedger(db, { exportedAt: EXPORTED_AT }), 'locked');
  });

  it('fails every write to a content table, and writes nothing', async () => {
    const before = await rawRows(name, 'requests');
    await expectLedgerError(
      putRequest(db, makeRequest({ textHint: 'Edited request', textHash: sha(5) })),
      'locked',
    );
    await expectLedgerError(putGrant(db, makeGrant({ agent: 'dots' })), 'locked');
    await expectLedgerError(db.claims.delete(CLAIM.id), 'locked');
    expect(await rawRows(name, 'requests')).toEqual(before);
    expect(await rawRows(name, 'grants')).toHaveLength(1);
    expect(await rawRows(name, 'claims')).toHaveLength(1);
  });

  it('reads nothing of a content table, not a count, a key, or an empty table', async () => {
    await expectLedgerError(db.claims.count(), 'locked');
    await expectLedgerError(db.claims.toCollection().primaryKeys(), 'locked');
    await expectLedgerError(db.digests.toArray(), 'locked');
    await expectLedgerError(db.modelAnswers.count(), 'locked');
  });

  it('reads none of a table that holds plain rows besides sealed ones: zero partial reads', async () => {
    clearKeyring();
    const plain = makeClaim({ rawHash: sha(150), subjectHint: 'Written before encryption' });
    await upsertClaim(db, plain);
    expect(await keysOf('claims')).toContainEqual(expect.arrayContaining(['claimedAt', 'subjectHint']));
    setKeyring(LOCKED);
    await expectLedgerError(db.claims.toArray(), 'locked');
    setKeyring(SEALING);
    expect((await db.claims.toArray()).map((claim) => claim.subjectHint).sort()).toEqual([
      'Quarterly numbers',
      'Written before encryption',
    ]);
  });

  it('keeps the tables without content working', async () => {
    await putAdapterHealth(db, makeHealth());
    await setMeta(db, 'retentionDays', 30);
    expect(await getAdapterHealth(db, 'muse')).toMatchObject({ status: 'OK' });
    expect(await getMeta(db, 'retentionDays')).toBe(30);
    expect(await db.coverage.count()).toBe(0);
  });
});

describe('a sealed row changed at rest', () => {
  beforeEach(sealAndSeed);

  it('fails `unreadable` when a byte changed', async () => {
    const [row] = await rawRows(name, 'claims');
    const sealed = row?.sealed;
    if (!isSealed(sealed) || row === undefined) throw new Error('no sealed claim');
    const ct = Uint8Array.from(sealed.ct);
    ct[0] = (ct[0] ?? 0) ^ 0x01;
    await rawPut(name, 'claims', { ...row, sealed: { ...sealed, ct } });
    await expectLedgerError(getClaim(db, CLAIM.id), 'unreadable');
    await expectLedgerError(db.claims.toArray(), 'unreadable');
  });

  it('fails `unreadable` when a sealed value is moved to another row', async () => {
    const second = makeClaim({ rawHash: sha(160), counterparty: 'bob@example.com' });
    await upsertClaim(db, second);
    const rows = await rawRows(name, 'claims');
    const first = rows.find((row) => row.id === CLAIM.id);
    const other = rows.find((row) => row.id === second.id);
    if (first === undefined || other === undefined) throw new Error('claims not stored');
    await rawPut(name, 'claims', { ...other, sealed: first.sealed });
    await expectLedgerError(getClaim(db, second.id), 'unreadable');
    expect(await getClaim(db, CLAIM.id)).toMatchObject({ counterparty: 'alice@example.com' });
  });
});

describe('keys across a change', () => {
  it('opens rows sealed under the previous key during a passphrase change, and seals new ones under the new', async () => {
    setKeyring(SEALING);
    await seed(db);
    setKeyring({ sealing: true, guarded: true, current: NEXT, previous: KEY });
    expect(await getClaim(db, CLAIM.id)).toMatchObject({ counterparty: 'alice@example.com' });
    await putRequest(db, makeRequest({ textHint: 'Edited request', textHash: sha(7) }));
    const [request] = await rawRows(name, 'requests');
    expect(Reflect.get(request?.sealed ?? {}, 'k')).toBe(NEXT.id);
    // The key before dropped while unlocked: its rows do not open, said as such, never as a lock (SEC-6).
    setKeyring({ sealing: true, guarded: true, current: NEXT });
    await expectLedgerError(getClaim(db, CLAIM.id), 'unreadable');
  });

  it('writes plain rows while encryption is off, and still opens the sealed ones it holds a key for', async () => {
    setKeyring(SEALING);
    await upsertClaim(db, CLAIM);
    setKeyring({ sealing: false, guarded: true, current: KEY });
    await putRequest(db, REQUEST);
    expect(await keysOf('requests')).toEqual([Object.keys({ ...REQUEST, date: '' }).sort()]);
    expect(await getClaim(db, CLAIM.id)).toMatchObject({ counterparty: 'alice@example.com' });
    clearKeyring();
    await expectLedgerError(getClaim(db, CLAIM.id), 'locked');
  });
});
