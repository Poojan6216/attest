import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  getReceipt,
  getRequest,
  putReceipt,
  putRequest,
  receiptsByAgentAndDate,
  requestsByAgentAndDate,
} from '../../../src/ledger/repo';
import { expectLedgerError, makeReceipt, makeRequest, omit, sha, ulid, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('requests-receipts'));
});

afterEach(() => {
  db.close();
});

describe('putRequest', () => {
  it('stores a request that reads back as the exact domain object', async () => {
    const request = makeRequest();
    await putRequest(db, request);
    const stored = await getRequest(db, request.id);
    expect(stored).toEqual(request);
    expect(stored).not.toHaveProperty('date');
  });

  it('replaces by id on a second put and rejects invalid input', async () => {
    await putRequest(db, makeRequest());
    await putRequest(db, makeRequest({ textHint: 'Edited request', textHash: sha(202) }));
    expect(await db.requests.count()).toBe(1);
    expect((await getRequest(db, ulid(201)))?.textHint).toBe('Edited request');
    await expectLedgerError(
      putRequest(db, makeRequest({ id: ulid(9), textHint: 'x'.repeat(201) })),
      'invalid_input',
    );
    await expectLedgerError(putRequest(db, makeRequest({ id: 'not-a-ulid' })), 'invalid_input');
    expect(await db.requests.count()).toBe(1);
  });
});

describe('getRequest', () => {
  it('returns the stored request by id', async () => {
    await putRequest(db, makeRequest({ agent: 'chatgpt' }));
    expect((await getRequest(db, ulid(201)))?.agent).toBe('chatgpt');
  });

  it('returns undefined for an unknown id', async () => {
    await putRequest(db, makeRequest());
    expect(await getRequest(db, ulid(1))).toBeUndefined();
  });
});

describe('requestsByAgentAndDate', () => {
  it("returns one agent's requests on the local date of ts", async () => {
    const a = makeRequest({ id: ulid(1), ts: '2026-10-01T23:59:59-07:00' });
    const b = makeRequest({ id: ulid(2), ts: '2026-10-02T00:00:00-07:00' });
    const c = makeRequest({ id: ulid(3), agent: 'dots', ts: '2026-10-01T12:00:00-07:00' });
    for (const request of [a, b, c]) await putRequest(db, request);
    expect(await requestsByAgentAndDate(db, 'muse', '2026-10-01')).toEqual([a]);
    expect(await requestsByAgentAndDate(db, 'dots', '2026-10-01')).toEqual([c]);
  });

  it('rejects a malformed date', async () => {
    await putRequest(db, makeRequest());
    await expectLedgerError(requestsByAgentAndDate(db, 'muse', '10/01/2026'), 'invalid_input');
  });
});

describe('putReceipt', () => {
  it('stores a receipt with its agent for indexing, but reads back only the domain object', async () => {
    const receipt = makeReceipt();
    await putReceipt(db, receipt, { agent: 'muse' });
    const stored = await getReceipt(db, receipt.id);
    expect(stored).toEqual(receipt);
    expect(stored).not.toHaveProperty('agent');
    expect(stored).not.toHaveProperty('date');
  });

  it('replaces PENDING with FINAL under the same id and rejects invalid input or agent', async () => {
    await putReceipt(db, makeReceipt(), { agent: 'muse' });
    const final = makeReceipt({ state: 'FINAL', finalAt: '2026-10-01T11:01:00-04:00' });
    await putReceipt(db, final, { agent: 'muse' });
    expect(await db.receipts.count()).toBe(1);
    expect(await getReceipt(db, final.id)).toEqual(final);
    await expectLedgerError(
      putReceipt(db, makeReceipt({ id: ulid(9), confidence: 2 }), { agent: 'muse' }),
      'invalid_input',
    );
    await expectLedgerError(
      putReceipt(db, makeReceipt({ id: ulid(9) }), { agent: 'siri' as never }),
      'invalid_input',
    );
    expect(await db.receipts.count()).toBe(1);
  });
});

describe('getReceipt', () => {
  it('returns an UNASKED receipt (no claimId) by id', async () => {
    const unasked = omit(omit(makeReceipt({ grade: 'UNASKED', ruleId: 'unasked' }), 'claimId'), 'requestId');
    await putReceipt(db, unasked, { agent: 'chatgpt' });
    expect(await getReceipt(db, unasked.id)).toEqual(unasked);
  });

  it('returns undefined for an unknown id', async () => {
    await putReceipt(db, makeReceipt(), { agent: 'muse' });
    expect(await getReceipt(db, ulid(77))).toBeUndefined();
  });
});

describe('receiptsByAgentAndDate', () => {
  it('indexes by the given agent and the local date of computedAt', async () => {
    const museToday = makeReceipt({ id: ulid(1) });
    const claudeToday = makeReceipt({ id: ulid(2) });
    const museTomorrow = makeReceipt({ id: ulid(3), computedAt: '2026-10-02T09:00:00-04:00' });
    await putReceipt(db, museToday, { agent: 'muse' });
    await putReceipt(db, claudeToday, { agent: 'claude' });
    await putReceipt(db, museTomorrow, { agent: 'muse' });
    expect(await receiptsByAgentAndDate(db, 'muse', '2026-10-01')).toEqual([museToday]);
    expect(await receiptsByAgentAndDate(db, 'claude', '2026-10-01')).toEqual([claudeToday]);
    expect(await receiptsByAgentAndDate(db, 'muse', '2026-10-02')).toEqual([museTomorrow]);
  });

  it('returns nothing for a day with no receipts and rejects a malformed date', async () => {
    await putReceipt(db, makeReceipt(), { agent: 'muse' });
    expect(await receiptsByAgentAndDate(db, 'muse', '2026-09-30')).toEqual([]);
    await expectLedgerError(receiptsByAgentAndDate(db, 'muse', '2026-02-30'), 'invalid_input');
  });
});
