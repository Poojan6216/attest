import 'fake-indexeddb/auto';
/**
 * The extension's two outbound calls refuse redirects (Sprint 5 close, security review SEC-3, QA GAP 11; Hard Rules 1
 * and 10): the person's own key's POST to its vendor (src/intel/providers/byo.ts) and the telemetry POST
 * (src/telemetry/send.ts) each set `redirect: 'error'`, so a server answering 3xx cannot send the facts, the key or the
 * numbers on to another host: the call fails instead. Each also carries no cookie, no referrer and no cache, the
 * vendor's call the run's signal, and the telemetry call a time limit (tech review TECH-13). Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHECK_INPUTS } from '../../../entrypoints/model-check/inputs';
import { TELEMETRY_TIMEOUT_MS } from '../../../src/config';
import { TELEMETRY_ENDPOINT } from '../../../src/config-network';
import { byoProvider } from '../../../src/intel/providers/byo';
import { saveFlag } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { sendTelemetry } from '../../../src/telemetry/send';
import { uniqueDbName } from '../ledger/fixtures';

const FACTS = { installId: '4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b', extVersion: '0.1.0', chromeMajor: 154 };
const NOW = new Date(2026, 9, 10, 9, 30).getTime();
const KEY = 'sk-ant-invented-redirect-0123456789';
const ANSWER = '{"content":[{"type":"text","text":"{\\"scores\\":[]}"}]}';

let db: LedgerDb;
let calls: { url: string; init: RequestInit }[];

beforeEach(async () => {
  db = await openLedger(uniqueDbName('outbound-calls'));
  calls = [];
});

afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});

/** Stubs `fetch` to record each call and answer `answer`. */
function answering(answer: () => Response) {
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(answer());
  });
}

describe('the outbound calls refuse redirects', () => {
  it('the own key’s call refuses a redirect and passes the run’s signal', async () => {
    answering(() => new Response(ANSWER));
    const input = CHECK_INPUTS[0];
    if (input === undefined) throw new Error('no check input');
    const run = new AbortController();
    await byoProvider('anthropic', KEY).score(input, run.signal);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: run.signal,
    });
  });

  it('the telemetry call refuses a redirect, and gives up after its time limit', async () => {
    answering(() => new Response(null, { status: 204 }));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    expect((await sendTelemetry({ db, nowMs: NOW, facts: () => Promise.resolve(FACTS) })).outcome).toBe(
      'sent',
    );
    expect(calls.map(({ url }) => url)).toEqual([TELEMETRY_ENDPOINT]);
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    expect(timeout).toHaveBeenCalledWith(TELEMETRY_TIMEOUT_MS);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a call that fails, as a refused redirect does, is a failed send, tried again at the next alarm', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    const deps = { db, nowMs: NOW, facts: () => Promise.resolve(FACTS) };
    expect((await sendTelemetry(deps)).outcome).toBe('failed');
    answering(() => new Response(null, { status: 204 }));
    expect((await sendTelemetry({ ...deps, nowMs: NOW + 3_600_000 })).outcome).toBe('sent');
  });
});
