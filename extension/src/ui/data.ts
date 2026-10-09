/**
 * What the pages read from the ledger (sprint_4 4.0): the popup, the side panel, the options page and the digest read
 * through these. Each call reads the page's own connection to the ledger (src/ledger/repo.ts `getLedger`, opened once
 * per page) through src/ledger/views.ts: indexed reads, a page at a time, nothing computed beyond joins and sorting.
 * Reading in the page, not through the service worker, keeps the popup from waiting for a stopped worker to start. A
 * page never writes the ledger: what a person changes goes to the service worker over the bus, and `onLedgerChanged`
 * says when the service worker changed a table the page shows, so the page reads it again.
 */
import { listen } from '../bus/listen';
import type { LedgerTable } from '../bus/messages';
import { POPUP_RECEIPT_LIMIT, TIMELINE_PAGE_SIZE } from '../config';
import { getLedger, listAdapterHealth, listGrants } from '../ledger/repo';
import { AgentId, type AdapterHealth, type Grade, type Grant } from '../ledger/types';
import {
  coverageSummary,
  type CoverageSummary,
  popupView,
  type PopupView,
  receiptDetail,
  type ReceiptCursor,
  type ReceiptDetail,
  receiptPage,
  type ReceiptPage,
} from '../ledger/views';

export type {
  CoverageSummary,
  PopupView,
  ReceiptCursor,
  ReceiptDetail,
  ReceiptItem,
  ReceiptPage,
} from '../ledger/views';

/** Every agent, in the order the schema lists them. */
const EVERY_AGENT: readonly AgentId[] = AgentId.options;

/** Epoch ms of local midnight starting the day of `ms`, in the page's time zone. */
export function localDayStartMs(ms: number): number {
  const day = new Date(ms);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
}

/** Epoch ms of local midnight starting `date` (`YYYY-MM-DD`), in the page's time zone. */
function midnightOf(date: string): number {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = date.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

/**
 * The instants of the local days `from` to `to` (`YYYY-MM-DD`, both included): from the first's midnight to the last
 * millisecond before the midnight after the second. A date that does not parse gives NaN, and an empty range.
 */
export function localDaysMs(from: string, to: string): { readonly fromMs: number; readonly toMs: number } {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = to.split('-').map(Number);
  return { fromMs: midnightOf(from), toMs: new Date(year, month - 1, day + 1).getTime() - 1 };
}

/** The popup's reads: today's newest receipts (graded since local midnight), coverage, health and last imports. */
export async function loadPopup(now: Date = new Date()): Promise<PopupView> {
  const db = await getLedger();
  const fromMs = localDayStartMs(now.getTime());
  return popupView(db, { agents: EVERY_AGENT, fromMs, toMs: Infinity, limit: POPUP_RECEIPT_LIMIT });
}

/** The side panel's filters: which agents and grades, over which local days (`YYYY-MM-DD`, both included). */
export interface TimelineFilters {
  readonly agents: readonly AgentId[];
  /** Every grade when absent. */
  readonly grades?: readonly Grade[];
  readonly from: string;
  readonly to: string;
}

/** One page of the side panel's timeline, newest first; `after` is the page before's `next`. */
export async function loadTimelinePage(
  filters: TimelineFilters,
  after?: ReceiptCursor,
): Promise<ReceiptPage> {
  const db = await getLedger();
  const days = localDaysMs(filters.from, filters.to);
  if (!(days.fromMs <= days.toMs)) return { items: [], next: null };
  return receiptPage(db, {
    agents: filters.agents,
    ...(filters.grades === undefined ? {} : { grades: filters.grades }),
    ...days,
    limit: TIMELINE_PAGE_SIZE,
    ...(after === undefined ? {} : { after }),
  });
}

/** One receipt with its claim, request, evidence and grading inputs, or undefined when there is no such receipt. */
export async function loadReceipt(id: string): Promise<ReceiptDetail | undefined> {
  return receiptDetail(await getLedger(), id);
}

/** The coverage summary: the latest ping of each observer and account, and each agent's last pasted import. */
export async function loadCoverage(): Promise<CoverageSummary> {
  return coverageSummary(await getLedger());
}

/** The latest health report of every adapter and observer. */
export async function loadHealth(): Promise<AdapterHealth[]> {
  return listAdapterHealth(await getLedger());
}

/** Every agent's grant. */
export async function loadGrants(): Promise<Grant[]> {
  return listGrants(await getLedger());
}

/**
 * Calls `onChange` with the tables that changed whenever the service worker announces a change (`ledger.changed`) to
 * any of `tables`; returns the function that stops it. Register it while the page shows the data.
 */
export function onLedgerChanged(
  tables: readonly LedgerTable[],
  onChange: (changed: readonly LedgerTable[]) => void,
): () => void {
  const watched = new Set(tables);
  return listen({
    'ledger.changed': (message) => {
      const changed = message.tables.filter((table) => watched.has(table));
      if (changed.length > 0) onChange(changed);
    },
  });
}
