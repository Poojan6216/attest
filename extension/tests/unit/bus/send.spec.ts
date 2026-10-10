/**
 * Outgoing side: invalid messages never leave, transport failures resolve `undefined` and are logged,
 * and `query()` always resolves a `ui.result` for the kind it asked about.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { BUS_ERROR_CODES, BusError, transportErrorCode } from '../../../src/bus/errors';
import { listen } from '../../../src/bus/listen';
import { type BusMessage, BUS_MESSAGE_TYPES, type BusMessageType } from '../../../src/bus/messages';
import { extensionContextAlive, postAcked, query, send, sendChecked } from '../../../src/bus/send';
import type { IsoTs, Sha256 } from '../../../src/core/schema';
import {
  IMPORTED_CLAIM,
  CLAIM,
  captureLogs,
  connectAs,
  extensionPage,
  MALFORMED,
  OBSERVATION,
  SECRET,
  TS,
  VALID,
} from './harness';

const records = captureLogs();

beforeEach(() => {
  fakeBrowser.reset();
});

/**
 * One invalid message per type that the compiler accepts: TypeScript cannot see ranges or extra fields
 * carried by a variable, and a branded format is only a cast away from any string. This is what `send()`
 * exists to catch.
 */
function typedButInvalid(): Record<BusMessageType, BusMessage> {
  const smuggledClaim = { ...CLAIM, body: SECRET };
  const smuggledObservation = { ...OBSERVATION, html: SECRET };
  return {
    'adapter.health': {
      type: 'adapter.health',
      health: { ...VALID['adapter.health'].health, checkedAt: 'now' as IsoTs },
    },
    'adapter.claims': { ...VALID['adapter.claims'], claims: [smuggledClaim] },
    'adapter.scope': {
      ...VALID['adapter.scope'],
      snapshot: { ...VALID['adapter.scope'].snapshot, scopes: [`Gmail\n${SECRET}`] },
    },
    'observer.observations': { ...VALID['observer.observations'], observations: [smuggledObservation] },
    'coverage.ping': {
      type: 'coverage.ping',
      ping: { ...VALID['coverage.ping'].ping, accountHash: SECRET as Sha256 },
    },
    'calendar.snapshot': {
      ...VALID['calendar.snapshot'],
      snapshot: { ...VALID['calendar.snapshot'].snapshot, range: SECRET },
    },
    'ui.query': { type: 'ui.query', query: { kind: 'health.list' }, ...{ extra: SECRET } },
    'ui.result': { type: 'ui.result', kind: 'health.list', ok: true, data: undefined },
    'ledger.changed': { type: 'ledger.changed', tables: [], at: TS as IsoTs },
    // A claim no paste read (another extractor): only the parser's claims may be imported.
    'claims.import': {
      ...VALID['claims.import'],
      claims: [{ ...IMPORTED_CLAIM, extractor: { ...IMPORTED_CLAIM.extractor, id: 'muse.activity' } }],
    },
    // A reason with no visible character is no reason (the receipt's own override schema).
    'receipt.event': {
      ...VALID['receipt.event'],
      event: { kind: 'override', grade: 'VERIFIED', reason: ' \u200b ' },
    },
    // A ceiling with no currency is no grant (the grant schema's own rule).
    'grant.save': {
      ...VALID['grant.save'],
      grant: { ...VALID['grant.save'].grant, spendCurrency: undefined },
    },
    // A window the options page does not offer, a reader that is an agent's, a field the wipe does not name.
    'retention.save': { type: 'retention.save', days: 45 as 30 },
    'reader.toggle': { ...VALID['reader.toggle'], reader: 'muse' as 'gmail' },
    'flag.set': { ...VALID['flag.set'], flag: 'ATTEST_DOTS' as 'ATTEST_AUTO_CHECK_GMAIL' },
    'byo.save': { ...VALID['byo.save'], key: SECRET },
    'byo.forget': { type: 'byo.forget', ...{ key: SECRET } },
    'telemetry.send': { type: 'telemetry.send', ...{ payload: SECRET } },
    'ledger.wipe': { type: 'ledger.wipe', ...{ confirm: SECRET } },
    // A new passphrase shorter than the shortest taken or of spaces only, an empty one, one too long, a smuggled field.
    'crypto.enable': { type: 'crypto.enable', passphrase: 'short' },
    'crypto.unlock': { type: 'crypto.unlock', passphrase: '' },
    'crypto.lock': { type: 'crypto.lock', ...{ passphrase: SECRET } },
    'crypto.change': { ...VALID['crypto.change'], next: ' '.repeat(12) },
    'crypto.disable': { type: 'crypto.disable', passphrase: 'x'.repeat(1_025) },
  };
}

describe('send(): outgoing validation', () => {
  it.each(BUS_MESSAGE_TYPES)(
    'an invalid %s throws BusError(invalid_outgoing) before anything is sent',
    async (type) => {
      const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
      const listener = vi.fn();
      fakeBrowser.runtime.onMessage.addListener(listener);

      const attempt = send(typedButInvalid()[type]);

      await expect(attempt).rejects.toBeInstanceOf(BusError);
      await expect(attempt).rejects.toMatchObject({ name: 'BusError', code: 'invalid_outgoing' });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('sends the validated message (a valid one is passed to Chrome unchanged)', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
    connectAs(extensionPage());
    listen({ 'adapter.claims': () => undefined });

    await send(VALID['adapter.claims']);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0]?.[0]).toEqual(VALID['adapter.claims']);
    expect(sendMessage.mock.calls[0]?.[1]).toBeTypeOf('function'); // callback form: lastError is checked
  });

  it('the error carries no content: its message is built from the code only', async () => {
    const attempt = send(typedButInvalid()['adapter.claims']);
    await expect(attempt).rejects.toThrow('bus: invalid_outgoing');
  });
});

describe('send(): transport failures', () => {
  it('nobody listening: runtime.lastError is read, logged as bus.send_failed, resolves undefined', async () => {
    await expect(send(VALID['adapter.health'])).resolves.toBeUndefined();

    expect(records).toEqual([
      {
        level: 'warn',
        event: 'bus.send_failed',
        fields: {
          type: 'adapter.health',
          error: expect.stringMatching(/^BusError code=send_failed /) as string,
        },
      },
    ]);
    expect(fakeBrowser.runtime.lastError).toBeUndefined();
  });

  it("Chrome's 'Receiving end does not exist' lastError is logged as no_receiver", async () => {
    fakeBrowser.runtime.onMessage.addListener(() => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });

    await expect(send(VALID['ledger.changed'])).resolves.toBeUndefined();

    expect(records).toHaveLength(1);
    expect(records[0]?.event).toBe('bus.send_failed');
    expect(records[0]?.fields.type).toBe('ledger.changed');
    expect(records[0]?.fields.error).toMatch(/^BusError code=no_receiver /);
    // ledger.changed is a broadcast: nobody listening is expected, so debug (TECH-9).
    expect(records[0]?.level).toBe('debug');
  });

  it('no_receiver for a message that is not a broadcast is still a warning', async () => {
    fakeBrowser.runtime.onMessage.addListener(() => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });

    await expect(send(VALID['coverage.ping'])).resolves.toBeUndefined();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 'warn', event: 'bus.send_failed' });
    expect(records[0]?.fields.error).toMatch(/^BusError code=no_receiver /);
  });
});

describe('send(): transport failures that still resolve', () => {
  it('a synchronous throw from sendMessage (orphaned context) resolves undefined and is logged', async () => {
    vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });

    await expect(send(VALID['coverage.ping'])).resolves.toBeUndefined();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'warn',
      event: 'bus.send_failed',
      fields: { type: 'coverage.ping' },
    });
    expect(records[0]?.fields.error).toMatch(/^BusError code=context_invalidated /);
  });

  it('a handler that rejects still answers, so the sender sees no transport failure', async () => {
    connectAs(extensionPage());
    listen({ 'adapter.claims': () => Promise.reject(new Error('disk full')) });

    await expect(send(VALID['adapter.claims'])).resolves.toBeUndefined();

    expect(records.map((record) => record.event)).toEqual(['bus.handler_failed']);
  });

  it('an observer handler that rejects is answered { ok: false, code: failed }', async () => {
    connectAs(extensionPage());
    listen({ 'adapter.health': () => Promise.reject(new Error('disk full')) });

    await expect(send(VALID['adapter.health'])).resolves.toEqual({ ok: false, code: 'failed' });

    expect(records.map((record) => record.event)).toEqual(['bus.handler_failed']);
  });
});

describe('sendChecked() and postAcked() (sprint_2 2.7 interface 6)', () => {
  it('reject a transport failure instead of resolving undefined', async () => {
    // Nobody listens: the fake browser's failure maps to a transport code (src/bus/errors.ts transportErrorCode).
    await expect(sendChecked(VALID['coverage.ping'])).rejects.toBeInstanceOf(BusError);
    await expect(postAcked(VALID['coverage.ping'])).rejects.toBeInstanceOf(BusError);
    expect(records.filter((record) => record.event === 'bus.send_failed')).toHaveLength(2);
  });

  it('reject an answer that is not a BusAck', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ ok: true, rows: [SECRET] });
      return true;
    });

    await expect(sendChecked(VALID['observer.observations'])).rejects.toEqual(new BusError('invalid_reply'));
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('never send a message that is not acknowledged, or not valid', async () => {
    await expect(sendChecked(VALID['ledger.changed'])).rejects.toEqual(new BusError('invalid_outgoing'));
    await expect(sendChecked(MALFORMED['coverage.ping'] as BusMessage)).rejects.toEqual(
      new BusError('invalid_outgoing'),
    );
    expect(records).toEqual([]);
  });
});

describe('query()', () => {
  it('resolves unavailable (and logs) when no service worker answers', async () => {
    await expect(query({ kind: 'health.list' })).resolves.toEqual({
      type: 'ui.result',
      kind: 'health.list',
      ok: false,
      error: 'unavailable',
    });
    expect(records.map((record) => [record.event, record.fields.reason ?? null])).toEqual([
      ['bus.send_failed', null],
      ['bus.query_unavailable', 'no_response'],
    ]);
  });

  it('resolves unavailable when the answer is not a ui.result', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ rows: [SECRET] });
      return true;
    });

    await expect(query({ kind: 'ledger.export' })).resolves.toEqual({
      type: 'ui.result',
      kind: 'ledger.export',
      ok: false,
      error: 'unavailable',
    });
    expect(records).toEqual([
      {
        level: 'warn',
        event: 'bus.query_unavailable',
        fields: { kind: 'ledger.export', reason: 'malformed_result' },
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('resolves unavailable when the answer is for a different kind', async () => {
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ type: 'ui.result', kind: 'health.list', ok: true, data: [] });
      return true;
    });

    const result = await query({ kind: 'ledger.export' });

    expect(result).toEqual({ type: 'ui.result', kind: 'ledger.export', ok: false, error: 'unavailable' });
    expect(records[0]?.fields).toEqual({ kind: 'ledger.export', reason: 'kind_mismatch' });
  });
});

describe('query(): invalid queries and failed results', () => {
  it('an invalid query is never sent: it rejects with BusError(invalid_outgoing)', async () => {
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');

    const attempt = query({ kind: 'health.list', ...{ filter: SECRET } });

    await expect(attempt).rejects.toMatchObject({ name: 'BusError', code: 'invalid_outgoing' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('passes a failed ui.result from the worker through unchanged', async () => {
    connectAs(extensionPage('/options.html'));
    listen({
      'ui.query': (message) => ({
        type: 'ui.result',
        kind: message.query.kind,
        ok: false,
        error: 'unknown_query',
      }),
    });

    await expect(query({ kind: 'health.list' })).resolves.toEqual({
      type: 'ui.result',
      kind: 'health.list',
      ok: false,
      error: 'unknown_query',
    });
    expect(records).toEqual([]);
  });
});

describe('transportErrorCode / BusError', () => {
  it("maps Chrome's transport messages to safe codes", () => {
    expect(transportErrorCode('Could not establish connection. Receiving end does not exist.')).toBe(
      'no_receiver',
    );
    expect(transportErrorCode('The message port closed before a response was received.')).toBe('port_closed');
    expect(
      transportErrorCode(
        'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
      ),
    ).toBe('port_closed');
    expect(transportErrorCode('Extension context invalidated.')).toBe('context_invalidated');
    expect(transportErrorCode('something else entirely')).toBe('send_failed');
    expect(transportErrorCode(undefined)).toBe('send_failed');
  });

  it('every code builds an error whose message names only the code', () => {
    for (const code of BUS_ERROR_CODES) {
      const error = new BusError(code, { cause: new Error(SECRET) });
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('BusError');
      expect(error.code).toBe(code);
      expect(error.message).toBe(`bus: ${code}`);
    }
  });
});

describe('extensionContextAlive (Decisions [2.close] S5, SEC-3)', () => {
  it('is true while the runtime has an id, and false once Chrome cleared it or it cannot be read', () => {
    expect(extensionContextAlive()).toBe(true);
    const runtime = fakeBrowser.runtime as { id?: string };
    const id = runtime.id;
    try {
      Object.defineProperty(runtime, 'id', { configurable: true, value: undefined });
      expect(extensionContextAlive()).toBe(false);
      Object.defineProperty(runtime, 'id', {
        configurable: true,
        get: () => {
          throw new Error('Extension context invalidated.');
        },
      });
      expect(extensionContextAlive()).toBe(false);
    } finally {
      Object.defineProperty(runtime, 'id', { configurable: true, writable: true, value: id });
    }
    expect(extensionContextAlive()).toBe(true);
  });
});
