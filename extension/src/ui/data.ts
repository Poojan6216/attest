/**
 * What the pages read from the ledger (sprint_4 4.0): the popup and the side panel read through these. The other reads
 * are readers only too (the lint fence holds pages to readers; sprint_4 close, tech review TECH-1), each in a module of
 * its own so the popup's start loads none of them (TECH-5): the options page's settings and grants
 * (./settings-data.ts), the digest page's stored digests (src/ledger/digest.ts `getDigest`, `digestWeeks`), and the
 * options page's export, a page at a time (src/ledger/export-file.ts, export-csv.ts). Each call reads the page's own
 * connection to the ledger (src/ledger/shared.ts `getLedger`, opened once per page) through src/ledger/views.ts:
 * indexed reads, a page at a time, nothing computed beyond joins and sorting.
 * Reading in the page, not through the service worker, keeps the popup from waiting for a stopped worker to start. A
 * page never writes the ledger: what a person changes goes to the service worker over the bus, and `onLedgerChanged`
 * says when the service worker changed a table the page shows, so the page reads it again.
 *
 * The popup must paint in under 100 ms (sprint_4 4.2), so what it loads at its start is only what it reads: a
 * receipt's detail (src/ledger/detail.ts) and the bus listener load when first used, never at the start.
 */
import type { LedgerTable } from '../bus/messages';
import { POPUP_RECEIPT_LIMIT, TIMELINE_PAGE_SIZE } from '../config';
import type { ReceiptDetail } from '../ledger/detail';
import { getLedger, onKeyringReloaded } from '../ledger/shared';
import { log } from '../log';
import { AgentId, type Grade } from '../ledger/types';
import {
  sidePanelOverview,
  type SidePanelOverview,
  popupView,
  type PopupView,
  type ReceiptCursor,
  receiptPage,
  type ReceiptPage,
} from '../ledger/views';

export type { ReceiptDetail } from '../ledger/detail';
export type {
  CoverageSummary,
  PopupView,
  ReceiptCursor,
  ReceiptItem,
  ReceiptPage,
  SidePanelOverview,
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

/**
 * One page of the side panel's timeline, newest first; `after` is the page before's `next`. `limit` reads more than one
 * page at once: the side panel reads again as many receipts as it shows when the ledger changes, so its list keeps
 * its place (TIMELINE_PAGE_SIZE when absent).
 */
export async function loadTimelinePage(
  filters: TimelineFilters,
  after?: ReceiptCursor,
  limit: number = TIMELINE_PAGE_SIZE,
): Promise<ReceiptPage> {
  const db = await getLedger();
  const days = localDaysMs(filters.from, filters.to);
  if (!(days.fromMs <= days.toMs)) return { items: [], next: null };
  return receiptPage(db, {
    agents: filters.agents,
    ...(filters.grades === undefined ? {} : { grades: filters.grades }),
    ...days,
    limit,
    ...(after === undefined ? {} : { after }),
  });
}

/** The side panel's overview: the coverage summary and the health reports, and the last batch's instant (or null). */
export async function loadOverview(): Promise<SidePanelOverview> {
  return sidePanelOverview(await getLedger());
}

/** One receipt with its claim, request, evidence and grading inputs, or undefined when there is no such receipt. */
export async function loadReceipt(id: string): Promise<ReceiptDetail | undefined> {
  const [{ receiptDetail }, db] = await Promise.all([import('../ledger/detail'), getLedger()]);
  return receiptDetail(db, id);
}

/**
 * Calls `onChange` with the tables that changed whenever the service worker announces a change (`ledger.changed`) to
 * any of `tables`, and with every table watched whenever this page's keys change (sprint_6 6.5: the ledger unlocked or
 * locked); returns the function that stops it. The listener loads after the page's start (header); once it listens
 * it calls `onChange` once with every table watched, so a change announced before it listened is read too.
 */
export function onLedgerChanged(
  tables: readonly LedgerTable[],
  onChange: (changed: readonly LedgerTable[]) => void,
): () => void {
  const watched = new Set(tables);
  let stopped = false;
  let stop: () => void = () => undefined;
  const stopKeys = onKeyringReloaded(() => {
    onChange([...watched]);
  });
  void import('../bus/listen').then(
    ({ listen }) => {
      if (stopped) return;
      stop = listen({
        'ledger.changed': (message) => {
          const changed = message.tables.filter((table) => watched.has(table));
          if (changed.length > 0) onChange(changed);
        },
      });
      onChange([...watched]);
    },
    (error: unknown) => {
      log.error('ui.listen_failed', { error });
    },
  );
  return () => {
    stopped = true;
    stop();
    stopKeys();
  };
}
