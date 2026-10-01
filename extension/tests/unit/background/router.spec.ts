import 'fake-indexeddb/auto';

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { answerUiQuery, createHandlers } from '../../../src/background/router';
import { UiResultMessage } from '../../../src/bus/messages';
import { LedgerExport } from '../../../src/ledger/export';
import { closeLedger, getLedger, putAdapterHealth } from '../../../src/ledger/repo';
import { AdapterHealth } from '../../../src/ledger/types';
import { makeHealth } from '../ledger/fixtures';

const FIXED_CLOCK = () => '2026-10-01T14:10:00-04:00';

beforeEach(async () => {
  fakeBrowser.reset();
  const db = await getLedger();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterEach(async () => {
  await closeLedger();
});

describe('answerUiQuery', () => {
  it('ledger.export answers with a valid ui.result carrying a schema-valid export', async () => {
    const result = await answerUiQuery({ kind: 'ledger.export' }, FIXED_CLOCK);
    expect(UiResultMessage.parse(result)).toEqual(result);
    expect(result).toMatchObject({ type: 'ui.result', kind: 'ledger.export', ok: true });
    if (!result.ok) throw new Error('expected ok');
    const exported = LedgerExport.parse(result.data);
    expect(exported.exportedAt).toBe('2026-10-01T14:10:00-04:00');
    expect(exported.tables.receipts).toEqual([]);
  });

  it('health.list answers with the stored adapter health reports', async () => {
    const health = makeHealth({ status: 'DEGRADED', reasons: ['not_sent_folder'] });
    await putAdapterHealth(await getLedger(), health);
    const result = await answerUiQuery({ kind: 'health.list' }, FIXED_CLOCK);
    if (!result.ok) throw new Error('expected ok');
    expect(AdapterHealth.array().parse(result.data)).toEqual([health]);
  });
});

describe('createHandlers', () => {
  it('handles ui.query only in Sprint 0 (observers and adapters add theirs later)', () => {
    expect(Object.keys(createHandlers(FIXED_CLOCK))).toEqual(['ui.query']);
  });
});
