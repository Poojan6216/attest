/**
 * OBS-1 (Hard Rules 2, 6): no page text reaches the ledger or the export through a health reason or a
 * component's id or version. Observers run health() inside Gmail and Calendar tabs, beside message bodies, so an
 * extractor bug or a compromised content script could otherwise store 32 multi-line reasons of mail
 * (probe p8) or an extractor id that quotes the page (probe p9). Each is refused with `invalid_input`, names
 * only field paths, and writes nothing; a report of codes is stored and exported as it is.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { exportLedger } from '../../../src/ledger/export';
import { openLedger } from '../../../src/ledger/migrations';
import {
  putAdapterHealth,
  putCoveragePing,
  putGrant,
  putRequest,
  setMeta,
  upsertClaim,
} from '../../../src/ledger/repo';
import type { AdapterHealthInput, GrantInput } from '../../../src/ledger/types';
import {
  captureLogs,
  expectLedgerError,
  makeClaim,
  makeGrant,
  makeHealth,
  makePing,
  makeRequest,
  uniqueDbName,
} from './fixtures';
import { healthReports } from '../../../src/ledger/views';

/** Probe p8: a message body padded to the old 120-character reason cap. */
const BODY = 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120.\nThanks, P'.padEnd(120, '.');
/** Probe p9: an id that quotes the page. */
const QUOTED = 'door code\n4417 SSN 078-05-1120';
const SECRETS = ['078-05-1120', '4417', 'Priya'];

let db: LedgerDb;
let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('text-channels'));
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  db.close();
});

/** Nothing the ledger exports, throws or logs holds a seed. */
async function expectNoSeed(error: unknown): Promise<void> {
  const exported = JSON.stringify(await exportLedger(db, { exportedAt: '2026-10-06T15:00:00-04:00' }));
  const shown = `${String(error)} ${JSON.stringify(error)} ${JSON.stringify(logs.records)} ${exported}`;
  expect(SECRETS.filter((seed) => shown.includes(seed))).toStrictEqual([]);
}

describe('putAdapterHealth refuses page text (probe p8)', () => {
  it('refuses 32 message bodies as reasons, writes nothing, and exports nothing of them', async () => {
    const health = makeHealth({ status: 'DEGRADED', reasons: Array.from({ length: 32 }, () => BODY) });
    const error = await expectLedgerError(putAdapterHealth(db, health), 'invalid_input');
    expect(error.context).toMatchObject({ table: 'adapterHealth' });
    expect(String(error.context.paths).split('|')).toContain('reasons.0');
    expect(await db.adapterHealth.count()).toBe(0);
    await expectNoSeed(error);
  });

  const QUOTING: readonly (readonly [string, Partial<AdapterHealthInput>, string])[] = [
    ['a sentence as a reason', { reasons: ['Selector missing'] }, 'reasons.0'],
    ['one line of the body as a reason', { reasons: [BODY.slice(10, 40)] }, 'reasons.0'],
    ['a quoting adapterId', { adapterId: QUOTED }, 'adapterId'],
    ['a quoting version', { version: QUOTED }, 'version'],
  ];

  it.each(QUOTING)('refuses %s at its path', async (_label, overrides, path) => {
    const error = await expectLedgerError(putAdapterHealth(db, makeHealth(overrides)), 'invalid_input');
    expect(error.context.paths).toBe(path);
    expect(await db.adapterHealth.count()).toBe(0);
    await expectNoSeed(error);
  });

  it('stores and lists a DEGRADED report of reason codes exactly', async () => {
    const health = makeHealth({ status: 'DEGRADED', reasons: ['selector.missing', 'not_sent_folder'] });
    expect(await putAdapterHealth(db, health)).toEqual({ written: true });
    expect(await healthReports(db)).toEqual([health]);
  });
});

describe('claims and coverage refuse a component id that quotes the page (probe p9)', () => {
  it.each([
    ['extractor.id', { id: QUOTED, version: '1.0.0', confidence: 1 }],
    ['extractor.version', { id: 'muse.activity', version: QUOTED, confidence: 1 }],
  ] as const)('upsertClaim refuses a quoting %s and writes nothing', async (path, extractor) => {
    const error = await expectLedgerError(upsertClaim(db, makeClaim({ extractor })), 'invalid_input');
    expect(error.context).toMatchObject({ table: 'claims', paths: path });
    expect(await db.claims.count()).toBe(0);
    await expectNoSeed(error);
  });

  it('putCoveragePing refuses a quoting observerId and writes nothing', async () => {
    const error = await expectLedgerError(
      putCoveragePing(db, makePing({ observerId: QUOTED })),
      'invalid_input',
    );
    expect(error.context).toMatchObject({ table: 'coverage', paths: 'observerId' });
    expect(await db.coverage.count()).toBe(0);
    await expectNoSeed(error);
  });
});

describe('a conversation id, a scope and an allowlist entry are never page text (R3-LEDGER-2, probes r4, r8)', () => {
  /** Probe r4: a conversation's opening lines taken for its id, padded to the 128-character cap. */
  const QUOTE = 'Hi Priya,\nthe door code is 4417.\nSSN 078-05-1120\nThanks, P'.padEnd(128, '.');

  it.each([QUOTE, 'Hi Priya the door code is 4417', 'SSN 078-05-1120'])(
    'putRequest refuses the conversationId %j, writes nothing and exports nothing of it',
    async (conversationId) => {
      const error = await expectLedgerError(putRequest(db, makeRequest({ conversationId })), 'invalid_input');
      expect(error.context).toStrictEqual({ table: 'requests', paths: 'conversationId' });
      expect(await db.requests.count()).toBe(0);
      expect(await db.requests.where('conversationId').equals(conversationId).count()).toBe(0);
      await expectNoSeed(error);
    },
  );

  it('putRequest stores a UUID conversation id as it is', async () => {
    const request = makeRequest({ conversationId: '6710a2b4-0c3e-8001-9a7f-1c2d3e4f5a6b' });
    await putRequest(db, request);
    expect(await db.requests.where('conversationId').equals(request.conversationId).count()).toBe(1);
  });

  const GRANT_TEXT: readonly (readonly [string, Partial<GrantInput>])[] = [
    ['observedScopes.0', { observedScopes: [QUOTE.slice(0, 120)] }],
    ['declaredScopes.1', { declaredScopes: ['gmail.send', 'Read your mail\nSSN 078-05-1120'] }],
    ['counterpartyAllowlist.0', { counterpartyAllowlist: ['example.com\nthe door code is 4417'] }],
  ];

  it.each(GRANT_TEXT)('putGrant refuses a multi-line %s and writes nothing', async (path, overrides) => {
    const error = await expectLedgerError(putGrant(db, makeGrant(overrides)), 'invalid_input');
    expect(error.context).toStrictEqual({ table: 'grants', paths: path });
    expect(await db.grants.count()).toBe(0);
    await expectNoSeed(error);
  });

  it('setMeta refuses a key that is not a token', async () => {
    const error = await expectLedgerError(setMeta(db, 'door code 4417', 1), 'invalid_input');
    expect(error.context).toStrictEqual({ table: 'meta', paths: 'key' });
    expect(await db.meta.count()).toBe(0);
    await expectNoSeed(error);
  });
});
