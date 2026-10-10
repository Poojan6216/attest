/**
 * The side panel's sender (entrypoints/sidepanel/App.tsx `sendImport`; sprint_3 3.13) over the bus to a service-worker
 * handler (Sprint 3 QA review: App.tsx was at 60% of its lines, the failure mapping never ran outside Chrome): it sends
 * the agent, the claims and their minutes, resolves the worker's counts when the import is stored, and turns a refusal
 * or a handler that fails into the one failure the preview shows. Every log is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { sendImport } from '../../../entrypoints/sidepanel/App';
import { type BusHandler, listen } from '../../../src/bus/listen';
import type { ClaimsImportResult } from '../../../src/bus/messages';
import { captureLogs, connectAs, extensionPage, IMPORTED_CLAIM } from '../bus/harness';

const records = captureLogs();

beforeEach(() => {
  fakeBrowser.reset();
  connectAs(extensionPage('/sidepanel.html'));
});

const send = () => sendImport('muse', [IMPORTED_CLAIM], [IMPORTED_CLAIM.claimedAt]);

describe('sendImport', () => {
  it('sends the agent, the claims and their minutes only, and resolves the worker’s counts', async () => {
    const handler = vi.fn<BusHandler<'claims.import'>>(() =>
      Promise.resolve({ ok: true, received: 1, added: 0 }),
    );
    listen({ 'claims.import': handler });
    await expect(send()).resolves.toEqual({ ok: true, received: 1, added: 0 });
    expect(handler.mock.calls[0]?.[0]).toEqual({
      type: 'claims.import',
      agent: 'muse',
      claims: [IMPORTED_CLAIM],
      activeAt: [IMPORTED_CLAIM.claimedAt],
    });
  });

  it('a refusal, or a handler that fails, is the one failure the preview shows', async () => {
    const answers: (() => Promise<ClaimsImportResult>)[] = [
      () => Promise.resolve({ ok: false, code: 'id_conflict' }),
      () => Promise.reject(new Error('the ledger did not open')),
    ];
    listen({
      'claims.import': () => (answers.shift() ?? (() => Promise.resolve({ ok: false, code: 'failed' })))(),
    });
    await expect(send()).resolves.toEqual({ ok: false });
    await expect(send()).resolves.toEqual({ ok: false });
    expect(records.filter((record) => record.event === 'bus.handler_failed')).toHaveLength(1);
  });

  it('a message its schema refuses is never sent: it is logged and the import rejects (SEC-6)', async () => {
    const handler = vi.fn<BusHandler<'claims.import'>>();
    listen({ 'claims.import': handler });
    // Muse's claim imported as Claude's: the message's own check refuses it before it leaves the panel.
    await expect(sendImport('claude', [IMPORTED_CLAIM], [])).rejects.toMatchObject({
      code: 'invalid_outgoing',
    });
    expect(handler).not.toHaveBeenCalled();
    expect(records.map((record) => [record.event, record.fields.type])).toContainEqual([
      'bus.command_refused',
      'claims.import',
    ]);
  });
});
