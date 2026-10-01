/**
 * Sprint 0.7 Done-when, per message type (qa_tester rule 3): a valid message round-trips through
 * `send()` + `listen()` over the fake browser, and a malformed one is dropped and logged without the
 * handler ever running.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { type BusHandler, listen, type MessageSender } from '../../../src/bus/listen';
import type { BusMessageType, UiQueryMessage, UiResult } from '../../../src/bus/messages';
import { query, send } from '../../../src/bus/send';
import {
  captureLogs,
  connectAs,
  contentScript,
  eventsAt,
  extensionPage,
  MALFORMED,
  SECRET,
  sendRaw,
  serviceWorker,
  VALID,
} from './harness';

const records = captureLogs();

beforeEach(() => {
  fakeBrowser.reset();
});

/** Who sends each type in the product: content scripts report, UI pages ask, the worker notifies. */
const SENDER_OF: Readonly<Record<BusMessageType, () => MessageSender>> = {
  'adapter.health': contentScript,
  'adapter.claims': contentScript,
  'observer.observations': contentScript,
  'coverage.ping': contentScript,
  'ui.query': () => extensionPage('/sidepanel.html'),
  'ui.result': serviceWorker,
  'ledger.changed': serviceWorker,
};

function sendFailures(): number {
  return records.filter((record) => record.event === 'bus.send_failed').length;
}

/** A fire-and-forget type: valid → handler gets an equal copy plus the sender; malformed → dropped. */
function fireAndForget(type: Exclude<BusMessageType, 'ui.query'>): void {
  describe(type, () => {
    it('valid: round-trips through send() and listen() and is acknowledged', async () => {
      const sender = SENDER_OF[type]();
      connectAs(sender);
      const handler = vi.fn();
      listen({ [type]: handler });

      await expect(send(VALID[type])).resolves.toBeUndefined();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toEqual(VALID[type]);
      expect(handler.mock.calls[0]?.[1]).toEqual(sender);
      expect(sendFailures()).toBe(0);
      expect(eventsAt(records, 'warn')).toEqual([]);
    });

    it('malformed: dropped and logged with its type; the handler never runs', async () => {
      connectAs(SENDER_OF[type]());
      const handler = vi.fn();
      listen({ [type]: handler });

      await expect(sendRaw(MALFORMED[type])).resolves.toBeUndefined();

      expect(handler).not.toHaveBeenCalled();
      expect(records).toContainEqual({
        level: 'warn',
        event: 'bus.dropped',
        fields: { reason: 'malformed', type },
      });
      expect(JSON.stringify(records)).not.toContain(SECRET);
    });
  });
}

fireAndForget('adapter.health');
fireAndForget('adapter.claims');
fireAndForget('observer.observations');
fireAndForget('coverage.ping');
fireAndForget('ui.result');
fireAndForget('ledger.changed');

describe('ui.query', () => {
  it('valid: query() round-trips to the handler and resolves its ui.result', async () => {
    const sender = SENDER_OF['ui.query']();
    connectAs(sender);
    const result: UiResult = {
      type: 'ui.result',
      kind: 'ledger.export',
      ok: true,
      data: { receipts: [], exportedAt: '2026-10-01T09:30:00Z' },
    };
    const handler = vi.fn<BusHandler<'ui.query'>>(() => Promise.resolve(result));
    listen({ 'ui.query': handler });

    await expect(query({ kind: 'ledger.export' })).resolves.toEqual(result);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toEqual(VALID['ui.query']);
    expect(handler.mock.calls[0]?.[1]).toEqual(sender);
    expect(eventsAt(records, 'warn')).toEqual([]);
  });

  it('malformed: an unknown query kind is dropped and logged; the handler never runs', async () => {
    connectAs(SENDER_OF['ui.query']());
    const handler = vi.fn((message: UiQueryMessage) => ({
      type: 'ui.result' as const,
      kind: message.query.kind,
      ok: true as const,
      data: null,
    }));
    listen({ 'ui.query': handler });

    await expect(sendRaw(MALFORMED['ui.query'])).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'malformed', type: 'ui.query' },
    });
  });
});
