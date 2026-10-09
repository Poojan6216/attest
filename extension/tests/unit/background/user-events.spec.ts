import 'fake-indexeddb/auto';
/**
 * The service worker's side of a person's override or revert (sprint_4 4.3; src/background/user-events.ts): the clock
 * guard runs, the event is applied (src/ledger/user-events.ts), a saved one is announced (`ledger.changed`: receipts)
 * and logged with the receipt's id and the override's grade, a refused one is answered and logged with its code, and the
 * person's reason is never logged (Hard Rule 10).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LedgerTable, ReceiptEventMessage } from '../../../src/bus/messages';
import { onReceiptEvent, type ReceiptEventContext } from '../../../src/background/user-events';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getReceipt, putReceipt } from '../../../src/ledger/repo';
import { Receipt, Ulid } from '../../../src/ledger/types';
import { captureLogs, makeReceipt, pinClock, releaseClock, ulid, uniqueDbName } from '../ledger/fixtures';

const REASON = 'zq-4471 I sent it myself';

let db: LedgerDb;
let logs: ReturnType<typeof captureLogs>;
let notify: ReturnType<typeof vi.fn<(tables: readonly LedgerTable[]) => void>>;
let ctx: ReceiptEventContext;

beforeEach(async () => {
  pinClock('2026-10-01T15:00:00Z');
  db = await openLedger(uniqueDbName('receipt-event'));
  logs = captureLogs();
  notify = vi.fn<(tables: readonly LedgerTable[]) => void>();
  ctx = { db: () => Promise.resolve(db), nowMs: () => Date.parse('2026-10-01T15:00:00Z'), notify };
});

afterEach(() => {
  logs.restore();
  db.close();
  releaseClock();
});

const message = (event: ReceiptEventMessage['event'], receiptId = ulid(301)): ReceiptEventMessage => ({
  type: 'receipt.event',
  receiptId: Ulid.parse(receiptId),
  event,
});

describe('onReceiptEvent', () => {
  it('saves an override and its revert, announces each, and logs them without the reason', async () => {
    await putReceipt(db, makeReceipt({ state: 'FINAL', finalAt: '2026-10-01T10:31:00-04:00' }));
    await expect(
      onReceiptEvent(ctx, message({ kind: 'override', grade: 'NOT_FOUND', reason: REASON })),
    ).resolves.toEqual({
      ok: true,
    });
    expect((await getReceipt(db, ulid(301)))?.override?.reason).toBe(REASON);
    await expect(onReceiptEvent(ctx, message({ kind: 'revert' }))).resolves.toEqual({ ok: true });
    expect(notify.mock.calls).toEqual([[['receipts']], [['receipts']]]);
    const events = logs.records.map(({ event, fields }) => [event, fields]);
    expect(events).toContainEqual(['receipt.overridden', { receiptId: ulid(301), grade: 'NOT_FOUND' }]);
    expect(events).toContainEqual(['receipt.reverted', { receiptId: ulid(301) }]);
    expect(JSON.stringify(logs.records)).not.toContain('zq-4471');
  });

  it('answers a refusal with its code, logs it, and announces nothing', async () => {
    await putReceipt(
      db,
      Receipt.parse(makeReceipt({ state: 'FINAL', finalAt: '2026-10-01T10:31:00-04:00' })),
    );
    await expect(onReceiptEvent(ctx, message({ kind: 'revert' }))).resolves.toEqual({
      ok: false,
      code: 'refused',
    });
    await expect(onReceiptEvent(ctx, message({ kind: 'revert' }, ulid(999)))).resolves.toEqual({
      ok: false,
      code: 'not_found',
    });
    expect(notify).not.toHaveBeenCalled();
    expect(
      logs.records.filter(({ event }) => event === 'receipt.event_refused').map(({ fields }) => fields),
    ).toEqual([
      { receiptId: ulid(301), kind: 'revert', code: 'refused' },
      { receiptId: ulid(999), kind: 'revert', code: 'not_found' },
    ]);
  });
});
