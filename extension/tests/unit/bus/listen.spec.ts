/**
 * Incoming side: one listener registered synchronously; foreign, malformed, unknown, untrusted and
 * unhandled messages are dropped and logged; handler failures are logged and still answered; the
 * listener never throws.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { listen } from '../../../src/bus/listen';
import type { UiResult } from '../../../src/bus/messages';
import { query, send } from '../../../src/bus/send';
import {
  captureLogs,
  connectAs,
  contentScript,
  eventsAt,
  extensionPage,
  foreignExtension,
  listenerOf,
  SECRET,
  sendRaw,
  serviceWorker,
  VALID,
} from './harness';

const records = captureLogs();

beforeEach(() => {
  fakeBrowser.reset();
});

function drops(): unknown[] {
  return records.filter((record) => record.event === 'bus.dropped').map((record) => record.fields);
}

describe('registration (MV3)', () => {
  // Deliberately synchronous: no await happens between listen() and the assertions.
  it('registers exactly one onMessage listener synchronously, at call time', () => {
    const addListener = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');

    const unsubscribe = listen({ 'adapter.health': () => undefined });

    expect(addListener).toHaveBeenCalledOnce();
    const listener = addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf('function');
    expect(listener !== undefined && fakeBrowser.runtime.onMessage.hasListener(listener)).toBe(true);
    unsubscribe();
    expect(listener !== undefined && fakeBrowser.runtime.onMessage.hasListener(listener)).toBe(false);
  });

  it('after unsubscribe, messages no longer reach the handler', async () => {
    const handler = vi.fn();
    const unsubscribe = listen({ 'ledger.changed': handler });
    unsubscribe();

    await expect(send(VALID['ledger.changed'])).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(records.map((record) => record.event)).toEqual(['bus.send_failed']);
  });
});

describe('drops', () => {
  it('drops a message from another extension, before parsing it', async () => {
    connectAs(foreignExtension());
    const handler = vi.fn();
    listen({ 'adapter.claims': handler });

    await expect(sendRaw(VALID['adapter.claims'])).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(drops()).toEqual([{ reason: 'foreign_sender', type: 'adapter.claims' }]);
  });

  it('checks the sender before parsing: a malformed foreign message is dropped as foreign_sender', async () => {
    connectAs(foreignExtension());
    const handler = vi.fn();
    listen({ 'adapter.claims': handler });

    await sendRaw({ ...VALID['adapter.claims'], claims: [{ body: SECRET }] });

    expect(handler).not.toHaveBeenCalled();
    expect(drops()).toEqual([{ reason: 'foreign_sender', type: 'adapter.claims' }]);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('fails closed when this extension id is unavailable (orphaned context): no id is no match', async () => {
    const ownId = fakeBrowser.runtime.id;
    // fakeBrowser.reset() does not restore runtime.id, so put it back however this test ends.
    Reflect.set(fakeBrowser.runtime, 'id', undefined);
    try {
      const handler = vi.fn();
      listen({ 'adapter.health': handler });

      // The fake's sender is `{}`: its id is undefined, like runtime.id now. They must not "match".
      await sendRaw(VALID['adapter.health']);

      expect(handler).not.toHaveBeenCalled();
      expect(drops()).toEqual([{ reason: 'foreign_sender', type: 'adapter.health' }]);
    } finally {
      Reflect.set(fakeBrowser.runtime, 'id', ownId);
    }
  });

  it('drops a message whose sender has no id (the fake default, and web pages)', async () => {
    const handler = vi.fn();
    listen({ 'adapter.health': handler });

    await sendRaw(VALID['adapter.health']);

    expect(handler).not.toHaveBeenCalled();
    expect(drops()).toEqual([{ reason: 'foreign_sender', type: 'adapter.health' }]);
  });
});

describe('drops: malformed, unknown and unhandled messages', () => {
  it('drops an unknown type and does not log the unknown type string', async () => {
    connectAs(contentScript());
    const handlers = { 'adapter.health': vi.fn(), 'ui.query': vi.fn() };
    listen(handlers);

    await sendRaw({ type: 'ledger.wipe', confirm: true });
    await sendRaw({ type: SECRET });

    expect(handlers['adapter.health']).not.toHaveBeenCalled();
    expect(handlers['ui.query']).not.toHaveBeenCalled();
    expect(drops()).toEqual([{ reason: 'malformed' }, { reason: 'malformed' }]);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('drops non-object messages without throwing', async () => {
    connectAs(contentScript());
    listen({ 'adapter.health': vi.fn() });

    for (const raw of [null, 'adapter.health', 42, true, [VALID['adapter.health']]]) {
      await expect(sendRaw(raw)).resolves.toBeUndefined();
    }

    expect(drops()).toHaveLength(5);
    expect(drops().every((fields) => JSON.stringify(fields) === '{"reason":"malformed"}')).toBe(true);
  });

  it('drops a valid message that has no handler in this context', async () => {
    connectAs(serviceWorker());
    listen({ 'adapter.health': vi.fn() });

    await sendRaw(VALID['ledger.changed']);

    expect(drops()).toEqual([{ reason: 'no_handler', type: 'ledger.changed' }]);
    // Routine wherever several contexts listen, so debug, not warn (TECH-9).
    expect(records.filter((r) => r.event === 'bus.dropped').map((r) => r.level)).toEqual(['debug']);
  });

  it('every other drop is a warning', async () => {
    connectAs(foreignExtension());
    listen({ 'adapter.health': vi.fn() });

    await sendRaw(VALID['adapter.health']);

    expect(records.filter((r) => r.event === 'bus.dropped').map((r) => r.level)).toEqual(['warn']);
  });
});

describe('drops: ui.query from anything but an extension page', () => {
  it('drops ui.query from a content script: only extension pages may ask for the ledger', async () => {
    connectAs(contentScript());
    const handler = vi.fn();
    listen({ 'ui.query': handler });

    await expect(sendRaw(VALID['ui.query'])).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(drops()).toEqual([{ reason: 'untrusted_context', type: 'ui.query' }]);
  });

  it('drops ui.query from a content script whose page URL merely contains the extension URL', async () => {
    const spoofed = `https://mail.google.com/mail/?next=${fakeBrowser.runtime.getURL('/popup.html')}`;
    connectAs({ id: fakeBrowser.runtime.id, url: spoofed, frameId: 0 });
    const handler = vi.fn();
    listen({ 'ui.query': handler });

    await sendRaw(VALID['ui.query']);

    expect(handler).not.toHaveBeenCalled();
    expect(drops()).toEqual([{ reason: 'untrusted_context', type: 'ui.query' }]);
  });

  it('drops ui.query from a sender that reports no url', async () => {
    connectAs({ id: fakeBrowser.runtime.id });
    const handler = vi.fn();
    listen({ 'ui.query': handler });

    await sendRaw(VALID['ui.query']);

    expect(handler).not.toHaveBeenCalled();
    expect(drops()).toEqual([{ reason: 'untrusted_context', type: 'ui.query' }]);
  });
});

describe('handler failures', () => {
  it('a throwing fire-and-forget handler is logged as bus.handler_failed and still acknowledged', async () => {
    connectAs(contentScript());
    listen({
      'observer.observations': () => {
        throw new Error(`could not store ${SECRET}`);
      },
    });

    await expect(send(VALID['observer.observations'])).resolves.toBeUndefined();

    expect(eventsAt(records, 'error')).toEqual([
      {
        level: 'error',
        event: 'bus.handler_failed',
        fields: {
          type: 'observer.observations',
          error: expect.stringMatching(/^Error messageLength=\d+$/) as string,
        },
      },
    ]);
    expect(records.some((record) => record.event === 'bus.send_failed')).toBe(false);
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('a rejecting ui.query handler answers ui.result handler_failed', async () => {
    connectAs(extensionPage());
    listen({ 'ui.query': () => Promise.reject(new Error('db closed')) });

    await expect(query({ kind: 'ledger.export' })).resolves.toEqual({
      type: 'ui.result',
      kind: 'ledger.export',
      ok: false,
      error: 'handler_failed',
    });
    expect(eventsAt(records, 'error').map((record) => record.fields.type)).toEqual(['ui.query']);
  });

  it('a synchronously throwing ui.query handler answers handler_failed', async () => {
    connectAs(extensionPage());
    listen({
      'ui.query': () => {
        throw new TypeError('boom');
      },
    });

    const result = await query({ kind: 'health.list' });

    expect(result).toEqual({ type: 'ui.result', kind: 'health.list', ok: false, error: 'handler_failed' });
  });
});

describe('handler failures: ui.query answers are checked before they leave', () => {
  it('a ui.query handler that answers for another kind is caught before the answer leaves', async () => {
    connectAs(extensionPage());
    const wrongKind: UiResult = { type: 'ui.result', kind: 'health.list', ok: true, data: [] };
    listen({ 'ui.query': () => wrongKind });

    const result = await query({ kind: 'ledger.export' });

    expect(result).toEqual({ type: 'ui.result', kind: 'ledger.export', ok: false, error: 'handler_failed' });
    expect(eventsAt(records, 'error')).toEqual([
      {
        level: 'error',
        event: 'bus.handler_failed',
        fields: {
          type: 'ui.query',
          error: expect.stringMatching(/^BusError code=invalid_result /) as string,
        },
      },
    ]);
  });

  it('a ui.query handler whose data would not survive the wire answers handler_failed', async () => {
    connectAs(extensionPage());
    listen({
      'ui.query': (message) => ({ type: 'ui.result', kind: message.query.kind, ok: true, data: undefined }),
    });

    const result = await query({ kind: 'health.list' });

    expect(result).toEqual({ type: 'ui.result', kind: 'health.list', ok: false, error: 'handler_failed' });
  });

  it('a fire-and-forget handler value is not forwarded (only ui.result has a response schema)', async () => {
    connectAs(contentScript());
    listen({ 'adapter.claims': () => ({ leaked: SECRET }) });

    await expect(send(VALID['adapter.claims'])).resolves.toBeUndefined();
  });
});

describe('the listener never throws', () => {
  it('survives a sendResponse that throws (port already gone)', async () => {
    const listener = listenerOf(() => listen({ 'adapter.health': () => undefined }));
    const sendResponse = vi.fn(() => {
      throw new Error('Attempting to use a disconnected port object');
    });

    expect(() => {
      listener(VALID['adapter.health'], contentScript(), sendResponse);
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(records.map((record) => record.event)).toContain('bus.respond_failed');
    });
    expect(sendResponse).toHaveBeenCalledOnce();
  });

  it('returns true only for messages it will answer (classic protocol)', () => {
    const listener = listenerOf(() => listen({ 'adapter.health': () => undefined }));
    const sendResponse = vi.fn();

    expect(listener(VALID['adapter.health'], contentScript(), sendResponse)).toBe(true);
    expect(listener(VALID['ledger.changed'], contentScript(), sendResponse)).toBe(false);
    expect(listener({ type: 'nope' }, contentScript(), sendResponse)).toBe(false);
    expect(listener(VALID['adapter.health'], foreignExtension(), sendResponse)).toBe(false);
  });

  it('survives a sender getter that throws', () => {
    const listener = listenerOf(() => listen({ 'adapter.health': () => undefined }));
    const hostile = {
      get id(): string {
        throw new Error('hostile');
      },
    };

    expect(listener(VALID['adapter.health'], hostile, vi.fn())).toBe(false);
    expect(records).toEqual([
      { level: 'error', event: 'bus.listener_failed', fields: { error: 'Error messageLength=7' } },
    ]);
  });

  it('survives a message whose type getter throws', () => {
    const listener = listenerOf(() => listen({ 'adapter.health': () => undefined }));
    const hostile = {
      get type(): string {
        throw new Error('hostile');
      },
    };

    expect(listener(hostile, contentScript(), vi.fn())).toBe(false);
    expect(records.map((record) => record.event)).toEqual(['bus.listener_failed']);
  });
});
