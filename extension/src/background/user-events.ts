/**
 * A person's override or revert from the side panel (sprint_4 4.3; src/ledger/user-events.ts): a `receipt.event` from
 * an extension page, applied in the service worker, the ledger's one writer. The clock guard runs first, as for every
 * message that stores rows (src/ledger/clock-guard.ts). A saved event is announced (`ledger.changed`: receipts) and
 * logged as `receipt.overridden` or `receipt.reverted`, with the receipt's id and the override's grade; a refused one
 * as `receipt.event_refused` with its code. The reason is the person's own words and is never logged (Hard Rule 10).
 */
import type { LedgerTable, ReceiptEventMessage, ReceiptEventResult } from '../bus/messages';
import { guardClock } from '../ledger/clock-guard';
import type { LedgerDb } from '../ledger/db';
import { applyUserEvent } from '../ledger/user-events';
import { log } from '../log';

export interface ReceiptEventContext {
  readonly db: () => Promise<LedgerDb>;
  /** The writer's clock, in epoch ms (the clock guard's now). */
  readonly nowMs: () => number;
  /** Tells open UI pages which tables moved (src/background/router.ts `announce`). */
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

/** Handles one `receipt.event` (header). */
export async function onReceiptEvent(
  ctx: ReceiptEventContext,
  message: ReceiptEventMessage,
): Promise<ReceiptEventResult> {
  const db = await ctx.db();
  await guardClock(db, ctx.nowMs());
  const { receiptId, event } = message;
  const outcome = await applyUserEvent(db, receiptId, event);
  if (!outcome.ok) {
    log.warn('receipt.event_refused', { receiptId, kind: event.kind, code: outcome.code });
    return { ok: false, code: outcome.code };
  }
  if (event.kind === 'override') log.info('receipt.overridden', { receiptId, grade: event.grade });
  else log.info('receipt.reverted', { receiptId });
  ctx.notify(['receipts']);
  return { ok: true };
}
