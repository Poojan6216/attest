/**
 * Sprint 0.7 Done-when, per message type (qa_tester rule 3): a valid message round-trips through
 * `send()` + `listen()` over the fake browser, and a malformed one is dropped and logged without the
 * handler ever running. Sprint 2.7: an observer message (messages.ts ACKED_TYPES) round-trips through
 * `sendChecked()` and is answered with its handler's `BusAck`; `postAcked()` rejects a refusal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { type BusHandler, listen, type MessageSender } from '../../../src/bus/listen';
import { BusError } from '../../../src/bus/errors';
import {
  ACK_OK,
  type AckedType,
  type BusAck,
  type BusMessageType,
  type UiQueryMessage,
  type UiResult,
} from '../../../src/bus/messages';
import { postAcked, query, send, sendChecked } from '../../../src/bus/send';
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
  'adapter.scope': contentScript,
  'observer.observations': contentScript,
  'coverage.ping': contentScript,
  'calendar.snapshot': contentScript,
  'ui.query': () => extensionPage('/sidepanel.html'),
  'ui.result': serviceWorker,
  'ledger.changed': serviceWorker,
};

function sendFailures(): number {
  return records.filter((record) => record.event === 'bus.send_failed').length;
}

/** A fire-and-forget type: valid → handler gets an equal copy plus the sender; malformed → dropped. */
function fireAndForget(type: Exclude<BusMessageType, 'ui.query' | AckedType>): void {
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

fireAndForget('adapter.claims');
fireAndForget('adapter.scope');
fireAndForget('ui.result');
fireAndForget('ledger.changed');

/** An acknowledged type: valid → its handler's `BusAck` comes back; a refusal rejects `postAcked`; malformed → dropped. */
function acknowledged(type: AckedType): void {
  describe(type, () => {
    it('valid: round-trips through sendChecked() and listen() and is answered with the BusAck', async () => {
      const sender = SENDER_OF[type]();
      connectAs(sender);
      const handler = vi.fn<(message: unknown, sender: unknown) => Promise<BusAck>>(() =>
        Promise.resolve(ACK_OK),
      );
      listen({ [type]: handler });

      await expect(sendChecked(VALID[type])).resolves.toEqual({ ok: true });
      await expect(postAcked(VALID[type])).resolves.toBeUndefined();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[0]?.[0]).toEqual(VALID[type]);
      expect(handler.mock.calls[0]?.[1]).toEqual(sender);
      expect(sendFailures()).toBe(0);
      expect(eventsAt(records, 'warn')).toEqual([]);
    });

    it('refused: sendChecked() resolves the refusal and postAcked() rejects with refused', async () => {
      connectAs(SENDER_OF[type]());
      listen({ [type]: () => Promise.resolve({ ok: false as const, code: 'late_sighting' as const }) });

      await expect(sendChecked(VALID[type])).resolves.toEqual({ ok: false, code: 'late_sighting' });
      await expect(postAcked(VALID[type])).rejects.toEqual(new BusError('refused'));
      expect(records).toContainEqual({
        level: 'debug',
        event: 'bus.refused',
        fields: { type, code: 'late_sighting' },
      });
    });

    it('a handler that answers something else is answered failed and logged at error', async () => {
      connectAs(SENDER_OF[type]());
      listen({ [type]: () => Promise.resolve({ ok: 'yes' }) });

      await expect(sendChecked(VALID[type])).resolves.toEqual({ ok: false, code: 'failed' });
      expect(eventsAt(records, 'error').map((record) => record.event)).toEqual(['bus.handler_failed']);
    });

    it('malformed: dropped and logged with its type; the handler never runs', async () => {
      connectAs(SENDER_OF[type]());
      const handler = vi.fn(() => Promise.resolve(ACK_OK));
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

acknowledged('adapter.health');
acknowledged('observer.observations');
acknowledged('coverage.ping');
acknowledged('calendar.snapshot');

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
