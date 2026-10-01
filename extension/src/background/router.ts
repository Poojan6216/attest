/**
 * Service-worker bus handlers. Sprint 0 answers UI queries only; observers (2.7) and adapters (3.6)
 * add their handlers here. Every handler is a thin call into the ledger: no business logic.
 */
import type { BusHandlers } from '../bus/listen';
import type { UiQuery, UiResult } from '../bus/messages';
import { exportLedger } from '../ledger/export';
import { getLedger, listAdapterHealth } from '../ledger/repo';

/** The clock lives at the edge (never in src/core). ISO 8601 with offset. */
export type Clock = () => string;

const systemClock: Clock = () => new Date().toISOString();

export async function answerUiQuery(query: UiQuery, clock: Clock = systemClock): Promise<UiResult> {
  const db = await getLedger();
  switch (query.kind) {
    case 'ledger.export':
      return {
        type: 'ui.result',
        kind: query.kind,
        ok: true,
        data: await exportLedger(db, { exportedAt: clock() }),
      };
    case 'health.list':
      return { type: 'ui.result', kind: query.kind, ok: true, data: await listAdapterHealth(db) };
  }
}

export function createHandlers(clock: Clock = systemClock): BusHandlers {
  return {
    'ui.query': (message) => answerUiQuery(message.query, clock),
  };
}
