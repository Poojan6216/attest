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
  type ClaimsImportResult,
  type UiQueryMessage,
  type UiResult,
} from '../../../src/bus/messages';
import {
  importClaims,
  postAcked,
  query,
  send,
  sendChecked,
  sendGrant,
  sendReceiptEvent,
} from '../../../src/bus/send';
import {
  captureLogs,
  connectAs,
  contentScript,
  eventsAt,
  extensionPage,
  IMPORTED_CLAIM,
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
  'claims.import': () => extensionPage('/sidepanel.html'),
  'receipt.event': () => extensionPage('/sidepanel.html'),
  'grant.save': () => extensionPage('/options.html'),
  'retention.save': () => extensionPage('/options.html'),
  'reader.toggle': () => extensionPage('/options.html'),
  'flag.set': () => extensionPage('/options.html'),
  'byo.save': () => extensionPage('/options.html'),
  'byo.forget': () => extensionPage('/options.html'),
  'telemetry.send': () => extensionPage('/options.html'),
  'ledger.wipe': () => extensionPage('/options.html'),
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

describe('reader off (sprint_4 4.5)', () => {
  it.each(['adapter.health', 'observer.observations', 'coverage.ping', 'calendar.snapshot'] as const)(
    '%s: postAcked() rejects with reader_off, so the skeleton stops',
    async (type) => {
      connectAs(SENDER_OF[type]());
      listen({ [type]: () => Promise.resolve({ ok: false as const, code: 'reader_off' as const }) });
      await expect(postAcked(VALID[type])).rejects.toEqual(new BusError('reader_off'));
    },
  );
});

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

describe('claims.import (sprint_3 3.13)', () => {
  it('valid: importClaims() round-trips from the side panel and resolves the handler’s counts', async () => {
    const sender = SENDER_OF['claims.import']();
    connectAs(sender);
    const result: ClaimsImportResult = { ok: true, received: 1, added: 1 };
    const handler = vi.fn<BusHandler<'claims.import'>>(() => Promise.resolve(result));
    listen({ 'claims.import': handler });
    await expect(importClaims('muse', [IMPORTED_CLAIM], [IMPORTED_CLAIM.claimedAt])).resolves.toEqual(result);
    expect(handler.mock.calls[0]?.[0]).toEqual(VALID['claims.import']);
    expect(eventsAt(records, 'warn')).toEqual([]);
  });

  it('from a content script: dropped as untrusted, never handled (only an extension page may import)', async () => {
    connectAs(contentScript());
    const handler = vi.fn<BusHandler<'claims.import'>>(() =>
      Promise.resolve({ ok: true, received: 1, added: 1 }),
    );
    listen({ 'claims.import': handler });
    await expect(sendRaw(VALID['claims.import'])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'untrusted_context', type: 'claims.import' },
    });
  });
});

describe('claims.import: malformed and failed (sprint_3 3.13)', () => {
  it('malformed: a field the schema does not name is dropped, and nothing of it is logged', async () => {
    connectAs(SENDER_OF['claims.import']());
    const handler = vi.fn<BusHandler<'claims.import'>>(() =>
      Promise.resolve({ ok: true, received: 1, added: 1 }),
    );
    listen({ 'claims.import': handler });
    await expect(sendRaw(MALFORMED['claims.import'])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(records)).not.toContain(SECRET);
  });

  it('a handler that answers badly or throws is answered failed, and importClaims() says so', async () => {
    connectAs(SENDER_OF['claims.import']());
    const answers = [
      () => Promise.resolve({ ok: true }),
      () => Promise.reject(new Error('the ledger did not open')),
    ];
    listen({
      'claims.import': () =>
        (answers.shift() ?? (() => Promise.resolve({})))() as Promise<ClaimsImportResult>,
    });
    await expect(importClaims('muse', [IMPORTED_CLAIM], [IMPORTED_CLAIM.claimedAt])).resolves.toEqual({
      ok: false,
      code: 'failed',
    });
    await expect(importClaims('muse', [IMPORTED_CLAIM], [IMPORTED_CLAIM.claimedAt])).resolves.toEqual({
      ok: false,
      code: 'failed',
    });
    expect(eventsAt(records, 'error').map((record) => record.event)).toEqual([
      'bus.handler_failed',
      'bus.handler_failed',
    ]);
  });
});

describe('receipt.event (sprint_4 4.3)', () => {
  it("from the side panel: answered with the handler's result", async () => {
    connectAs(SENDER_OF['receipt.event']());
    const handler = vi.fn<BusHandler<'receipt.event'>>(() => Promise.resolve({ ok: true }));
    listen({ 'receipt.event': handler });
    await expect(
      sendReceiptEvent(VALID['receipt.event'].receiptId, VALID['receipt.event'].event),
    ).resolves.toEqual({
      ok: true,
    });
    expect(handler.mock.calls[0]?.[0]).toEqual(VALID['receipt.event']);
  });

  it('from a content script: dropped as untrusted, never handled (only an extension page may change a receipt)', async () => {
    connectAs(contentScript());
    const handler = vi.fn<BusHandler<'receipt.event'>>(() => Promise.resolve({ ok: true }));
    listen({ 'receipt.event': handler });
    await expect(sendRaw(VALID['receipt.event'])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'untrusted_context', type: 'receipt.event' },
    });
  });

  it('a handler that answers badly or throws is answered failed; the reason is never logged', async () => {
    connectAs(SENDER_OF['receipt.event']());
    const reason =
      VALID['receipt.event'].event.kind === 'override' ? VALID['receipt.event'].event.reason : '';
    let answer: () => Promise<unknown> = () => Promise.resolve({ ok: 'yes' });
    listen({ 'receipt.event': () => answer() as Promise<{ ok: true }> });
    const sent = () => sendReceiptEvent(VALID['receipt.event'].receiptId, VALID['receipt.event'].event);
    await expect(sent()).resolves.toEqual({ ok: false, code: 'failed' });
    answer = () => Promise.reject(new Error('ledger closed'));
    await expect(sent()).resolves.toEqual({ ok: false, code: 'failed' });
    expect(JSON.stringify(records)).not.toContain(reason);
  });
});

describe('grant.save (sprint_4 4.4)', () => {
  it("from the options page: answered with the handler's result", async () => {
    connectAs(SENDER_OF['grant.save']());
    const handler = vi.fn<BusHandler<'grant.save'>>(() => Promise.resolve({ ok: true }));
    listen({ 'grant.save': handler });
    await expect(sendGrant(VALID['grant.save'].grant, false)).resolves.toEqual({ ok: true });
    expect(handler.mock.calls[0]?.[0]).toEqual(VALID['grant.save']);
  });

  it('from a content script: dropped as untrusted, never handled', async () => {
    connectAs(contentScript());
    const handler = vi.fn<BusHandler<'grant.save'>>(() => Promise.resolve({ ok: true }));
    listen({ 'grant.save': handler });
    await expect(sendRaw(VALID['grant.save'])).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(records).toContainEqual({
      level: 'warn',
      event: 'bus.dropped',
      fields: { reason: 'untrusted_context', type: 'grant.save' },
    });
  });
});
