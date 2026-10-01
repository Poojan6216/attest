import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  coverageByObserver,
  getAdapterHealth,
  getCoveragePing,
  getGrant,
  getMeta,
  listAdapterHealth,
  listGrants,
  putAdapterHealth,
  putCoveragePing,
  putGrant,
  setMeta,
} from '../../../src/ledger/repo';
import { expectLedgerError, makeGrant, makeHealth, makePing, omit, sha, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('state'));
});

afterEach(() => {
  db.close();
});

describe('putGrant / getGrant', () => {
  it('stores one grant per agent and reads it back exactly', async () => {
    const grant = makeGrant({ spendCeilingCents: 5000, observedScopes: ['gmail.read'] });
    await putGrant(db, grant);
    expect(await getGrant(db, 'muse')).toEqual(grant);
    expect(await getGrant(db, 'claude')).toBeUndefined();
  });

  it('replaces the grant on a second put and rejects invalid input', async () => {
    await putGrant(db, makeGrant());
    const tightened = makeGrant({ allowedTypes: ['email.sent'], updatedAt: '2026-10-02T09:00:00-04:00' });
    await putGrant(db, tightened);
    expect(await db.grants.count()).toBe(1);
    expect(await getGrant(db, 'muse')).toEqual(tightened);
    await expectLedgerError(
      putGrant(db, makeGrant({ agent: 'claude', spendCeilingCents: 1.5 })),
      'invalid_input',
    );
    await expectLedgerError(getGrant(db, 'cortana' as never), 'invalid_input');
  });
});

describe('listGrants', () => {
  it('lists every grant ordered by agent', async () => {
    for (const agent of ['muse', 'claude', 'chatgpt'] as const) await putGrant(db, makeGrant({ agent }));
    expect((await listGrants(db)).map((grant) => grant.agent)).toEqual(['chatgpt', 'claude', 'muse']);
  });

  it('is empty on a fresh ledger', async () => {
    expect(await listGrants(db)).toEqual([]);
  });
});

describe('putAdapterHealth', () => {
  it('stores the report and a newer one replaces it (compared as instants, not strings)', async () => {
    expect(await putAdapterHealth(db, makeHealth())).toEqual({ written: true });
    // 06:30-04:00 is 10:30Z: newer, although it sorts lower as a string.
    const newer = makeHealth({
      status: 'DEGRADED',
      reasons: ['selector.missing'],
      checkedAt: '2026-10-01T06:30:00-04:00',
    });
    expect(await putAdapterHealth(db, newer)).toEqual({ written: true });
    expect(await getAdapterHealth(db, 'muse')).toEqual(newer);
  });

  it('ignores an older report and rejects invalid input', async () => {
    const current = makeHealth({ status: 'DEGRADED', reasons: ['selector.missing'] });
    await putAdapterHealth(db, current);
    expect(await putAdapterHealth(db, makeHealth({ checkedAt: '2026-10-01T09:59:59Z' }))).toEqual({
      written: false,
    });
    expect(await getAdapterHealth(db, 'muse')).toEqual(current);
    await expectLedgerError(putAdapterHealth(db, makeHealth({ status: 'BROKEN' as never })), 'invalid_input');
  });

  it('a report at the same instant (any offset) replaces the stored one', async () => {
    await putAdapterHealth(db, makeHealth());
    // 06:00-04:00 is the same instant as the stored 10:00Z: a tie, so the latest write wins.
    const tie = makeHealth({
      status: 'DEGRADED',
      reasons: ['selector.missing'],
      checkedAt: '2026-10-01T06:00:00-04:00',
    });
    expect(await putAdapterHealth(db, tie)).toEqual({ written: true });
    expect(await getAdapterHealth(db, 'muse')).toEqual(tie);
  });
});

describe('getAdapterHealth / listAdapterHealth', () => {
  it('returns the latest report per adapter, ordered by adapter id', async () => {
    await putAdapterHealth(db, makeHealth({ adapterId: 'muse' }));
    await putAdapterHealth(db, makeHealth({ adapterId: 'gmail', version: '0.1.0' }));
    expect((await listAdapterHealth(db)).map((h) => h.adapterId)).toEqual(['gmail', 'muse']);
    expect((await getAdapterHealth(db, 'gmail'))?.version).toBe('0.1.0');
  });

  it('returns undefined / empty when nothing was reported', async () => {
    expect(await getAdapterHealth(db, 'claude')).toBeUndefined();
    expect(await listAdapterHealth(db)).toEqual([]);
  });
});

describe('putCoveragePing', () => {
  it('keeps one row per observer + account, including the account-less row', async () => {
    const noAccount = omit(makePing({ observerId: 'gcal' }), 'accountHash');
    await putCoveragePing(db, makePing());
    await putCoveragePing(db, makePing({ accountHash: sha(901) }));
    await putCoveragePing(db, noAccount);
    expect(await db.coverage.count()).toBe(3);
    expect(await getCoveragePing(db, 'gcal')).toEqual(noAccount);
    expect(await getCoveragePing(db, 'gmail', sha(901))).toEqual(makePing({ accountHash: sha(901) }));
  });

  it('ignores an older ping, accepts a newer one, and rejects a raw account identifier', async () => {
    await putCoveragePing(db, makePing());
    expect(await putCoveragePing(db, makePing({ lastSyncAt: '2026-10-01T09:00:00Z' }))).toEqual({
      written: false,
    });
    const newer = makePing({ lastSyncAt: '2026-10-01T11:00:00Z', windowEnd: '2026-10-01T11:00:00Z' });
    expect(await putCoveragePing(db, newer)).toEqual({ written: true });
    expect(await getCoveragePing(db, 'gmail', sha(900))).toEqual(newer);
    await expectLedgerError(
      putCoveragePing(db, makePing({ accountHash: 'alice@example.com' })),
      'invalid_input',
    );
    expect(await db.coverage.count()).toBe(1);
  });

  it('compares lastSyncAt as instants, not strings', async () => {
    await putCoveragePing(db, makePing());
    // 06:30-04:00 is 10:30Z: newer than the stored 10:00Z although it sorts lower as a string.
    const newer = makePing({
      lastSyncAt: '2026-10-01T06:30:00-04:00',
      windowEnd: '2026-10-01T06:30:00-04:00',
    });
    expect(await putCoveragePing(db, newer)).toEqual({ written: true });
    // 10:59+01:00 is 09:59Z: older than 10:30Z although it sorts higher as a string.
    const older = makePing({ lastSyncAt: '2026-10-01T10:59:00+01:00' });
    expect(await putCoveragePing(db, older)).toEqual({ written: false });
    expect(await getCoveragePing(db, 'gmail', sha(900))).toEqual(newer);
  });
});

describe('getCoveragePing / coverageByObserver', () => {
  it("lists every account of one observer and nothing of another's", async () => {
    await putCoveragePing(db, makePing({ accountHash: sha(902) }));
    await putCoveragePing(db, makePing({ accountHash: sha(901) }));
    await putCoveragePing(db, makePing({ observerId: 'gcal' }));
    const gmail = await coverageByObserver(db, 'gmail');
    expect(gmail.map((ping) => ping.accountHash)).toEqual([sha(901), sha(902)]);
  });

  it('returns undefined / empty for an unknown observer or account', async () => {
    await putCoveragePing(db, makePing());
    expect(await getCoveragePing(db, 'gmail')).toBeUndefined();
    expect(await getCoveragePing(db, 'gmail', sha(999))).toBeUndefined();
    expect(await coverageByObserver(db, 'outlook')).toEqual([]);
  });
});

describe('setMeta / getMeta', () => {
  it('stores string, number and boolean values and overwrites by key', async () => {
    await setMeta(db, 'lastPurgeAt', '2026-09-30T00:00:00Z');
    await setMeta(db, 'retentionDays', 90);
    await setMeta(db, 'encrypted', false);
    await setMeta(db, 'retentionDays', 30);
    expect(await getMeta(db, 'lastPurgeAt')).toBe('2026-09-30T00:00:00Z');
    expect(await getMeta(db, 'retentionDays')).toBe(30);
    expect(await getMeta(db, 'encrypted')).toBe(false);
  });

  it('returns undefined for a missing key and rejects an empty key or a non-scalar value', async () => {
    expect(await getMeta(db, 'missing')).toBeUndefined();
    await expectLedgerError(setMeta(db, '', 1), 'invalid_input');
    await expectLedgerError(setMeta(db, 'k', { nested: true } as never), 'invalid_input');
    expect(await db.meta.count()).toBe(0);
  });
});
