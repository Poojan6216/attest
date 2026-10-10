/**
 * The side panel's timeline (sprint_4 4.3): its filters, the receipts they select a page at a time (src/ui/data.ts
 * `loadTimelinePage`, newest first), the overview above them, and the receipt whose detail is open. When the service
 * worker announces a change to what the rows show (LIST_TABLES), the panel reads again as many receipts as it shows, so
 * its list keeps its place, the open detail and the overview too; a change to what only the overview shows
 * (coverage, health, meta) reads the overview alone (sprint_4 close, tech review TECH-7). Reads for one set of filters
 * never overlap: one asked for during a read runs once after it. A read lands only while what it was for is still
 * current: a list read for filters since changed, a detail for a receipt since closed, and an older page for a list
 * since read again are each dropped, so the newest state always wins (TECH-2, QA review GAP 5). A read that fails is
 * said and logged (Hard Rule 6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { LedgerTable, ReceiptEventMessage, ReceiptEventResult } from '../../src/bus/messages';
import { sendReceiptEvent } from '../../src/bus/send';
import { TIMELINE_DEFAULT_DAYS, TIMELINE_PAGE_SIZE } from '../../src/config';
import { localDate } from '../../src/ledger/digest-week';
import { AgentId } from '../../src/ledger/types';
import { log } from '../../src/log';
import { serial } from '../../src/ui/serial';
import {
  loadOverview,
  loadReceipt,
  loadTimelinePage,
  localDayStartMs,
  onLedgerChanged,
  type ReceiptCursor,
  type ReceiptDetail,
  type ReceiptItem,
  type ReceiptPage,
  type SidePanelOverview,
  type TimelineFilters,
} from '../../src/ui/data';

/** Where the side panel reads and writes: the ledger and the bus, or a test's stand-ins. */
export interface TimelineSources {
  readonly page: (filters: TimelineFilters, after?: ReceiptCursor, limit?: number) => Promise<ReceiptPage>;
  readonly overview: () => Promise<SidePanelOverview>;
  readonly receipt: (id: string) => Promise<ReceiptDetail | undefined>;
  readonly sendEvent: (
    receiptId: ReceiptEventMessage['receiptId'],
    event: ReceiptEventMessage['event'],
  ) => Promise<ReceiptEventResult>;
  /** Calls `onChange` with the tables that changed (all of them, when it names none). */
  readonly subscribe: (
    tables: readonly LedgerTable[],
    onChange: (changed?: readonly LedgerTable[]) => void,
  ) => () => void;
  readonly now: () => Date;
}

export const LIVE_TIMELINE: TimelineSources = {
  page: loadTimelinePage,
  overview: loadOverview,
  receipt: loadReceipt,
  sendEvent: sendReceiptEvent,
  subscribe: onLedgerChanged,
  now: () => new Date(),
};

/** The tables the rows and the detail show: a change to one reads the list, the open detail and the overview. */
export const LIST_TABLES: readonly LedgerTable[] = ['receipts', 'claims', 'requests'];

/** The tables the side panel shows something of: the rows', and the overview's alone. */
export const TIMELINE_TABLES: readonly LedgerTable[] = [...LIST_TABLES, 'coverage', 'adapterHealth', 'meta'];

const dateOf = (ms: number): string => localDate(new Date(ms));

/** Every agent and grade, over the last TIMELINE_DEFAULT_DAYS local days ending today. */
export function defaultFilters(now: Date): TimelineFilters {
  const today = localDayStartMs(now.getTime());
  const from = new Date(today);
  from.setDate(from.getDate() - (TIMELINE_DEFAULT_DAYS - 1));
  return { agents: AgentId.options, from: dateOf(from.getTime()), to: dateOf(today) };
}

export type ListState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'ready';
      readonly items: readonly ReceiptItem[];
      readonly next: ReceiptCursor | null;
      readonly more: 'idle' | 'loading' | 'failed';
    };

export interface Timeline {
  readonly filters: TimelineFilters;
  readonly setFilters: (filters: TimelineFilters) => void;
  readonly list: ListState;
  readonly loadMore: () => void;
  readonly overview: SidePanelOverview | null;
  readonly nowMs: number;
  readonly openId: string | null;
  readonly open: (id: string | null) => void;
  readonly detail: ReceiptDetail | undefined | 'loading' | 'failed';
  readonly sendEvent: TimelineSources['sendEvent'];
}

interface ReceiptList {
  readonly list: ListState;
  readonly overview: SidePanelOverview | null;
  readonly nowMs: number;
  readonly reread: () => void;
  readonly rereadOverview: () => void;
  readonly loadMore: () => void;
}

/** The overview above the list, read again by `reread`; a read lands only while the panel shows (header). */
function useOverview(sources: TimelineSources): { overview: SidePanelOverview | null; reread: () => void } {
  const [overview, setOverview] = useState<SidePanelOverview | null>(null);
  const reread = useMemo(
    () =>
      serial(async () => {
        try {
          setOverview(await sources.overview());
        } catch (error) {
          log.error('sidepanel.read_failed', { error });
        }
      }),
    [sources],
  );
  return { overview, reread };
}

/** The receipts `filters` select, a page at a time, and the overview above them (header). */
function useReceiptList(sources: TimelineSources, filters: TimelineFilters): ReceiptList {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [nowMs, setNowMs] = useState(() => sources.now().getTime());
  const top = useOverview(sources);
  // How many receipts the list shows, read when a read starts: a change reads again as many.
  const shown = useRef(0);
  shown.current = list.status === 'ready' ? list.items.length : 0;
  // The filters now shown: a read for others lands nowhere (TECH-2).
  const current = useRef(filters);
  current.current = filters;
  const reread = useMemo(
    () =>
      serial(async () => {
        setNowMs(sources.now().getTime());
        top.reread();
        try {
          const limit = Math.max(TIMELINE_PAGE_SIZE, shown.current);
          const page = await sources.page(filters, undefined, limit);
          if (current.current !== filters) return;
          setList({ status: 'ready', items: page.items, next: page.next, more: 'idle' });
        } catch (error) {
          log.error('sidepanel.read_failed', { error });
          if (current.current === filters) setList({ status: 'failed' });
        }
      }),
    [sources, filters, top.reread],
  );
  useEffect(() => {
    // New filters read one page from the top.
    shown.current = 0;
    setList({ status: 'loading' });
    reread();
  }, [reread]);
  const loadMore = useCallback(() => {
    if (list.status !== 'ready' || list.next === null || list.more === 'loading') return;
    const { items, next } = list;
    // The list this page extends: it lands only while that list is still the one shown (TECH-2).
    const extending: ListState = { ...list, more: 'loading' };
    setList(extending);
    sources.page(filters, next).then(
      (page) => {
        setList((shownList) =>
          shownList === extending
            ? { status: 'ready', items: [...items, ...page.items], next: page.next, more: 'idle' }
            : shownList,
        );
      },
      (error: unknown) => {
        log.error('sidepanel.read_failed', { error });
        setList((shownList) => (shownList === extending ? { ...extending, more: 'failed' } : shownList));
      },
    );
  }, [filters, list, sources]);
  return { list, overview: top.overview, nowMs, reread, rereadOverview: top.reread, loadMore };
}

/** The detail of the receipt `openId`, read again by `reread` (header). */
function useReceiptDetail(
  sources: TimelineSources,
  openId: string | null,
): { readonly detail: Timeline['detail']; readonly reread: () => void } {
  const [detail, setDetail] = useState<Timeline['detail']>(undefined);
  // The receipt now open: a read for one since closed lands nowhere (TECH-2).
  const current = useRef(openId);
  current.current = openId;
  const reread = useMemo(
    () =>
      serial(async () => {
        if (openId === null) return;
        try {
          const read = await sources.receipt(openId);
          if (current.current === openId) setDetail(read);
        } catch (error) {
          log.error('sidepanel.read_failed', { error });
          if (current.current === openId) setDetail('failed');
        }
      }),
    [openId, sources],
  );
  useEffect(() => {
    setDetail(openId === null ? undefined : 'loading');
    reread();
  }, [openId, reread]);
  return { detail, reread };
}

export function useTimeline(sources: TimelineSources = LIVE_TIMELINE): Timeline {
  const [filters, setFilters] = useState<TimelineFilters>(() => defaultFilters(sources.now()));
  const [openId, open] = useState<string | null>(null);
  const receipts = useReceiptList(sources, filters);
  const opened = useReceiptDetail(sources, openId);
  // One subscription for the panel's life: a change to the rows reads the latest list (and the overview with it) and
  // detail; one to the overview's tables alone reads the overview (TECH-7).
  const latest = useRef({ list: receipts.reread, overview: receipts.rereadOverview, detail: opened.reread });
  latest.current = { list: receipts.reread, overview: receipts.rereadOverview, detail: opened.reread };
  useEffect(
    () =>
      sources.subscribe(TIMELINE_TABLES, (changed) => {
        if (changed === undefined || changed.some((table) => LIST_TABLES.includes(table))) {
          latest.current.list();
          latest.current.detail();
        } else latest.current.overview();
      }),
    [sources],
  );
  const { list, overview, nowMs, loadMore } = receipts;
  return {
    filters,
    setFilters,
    list,
    loadMore,
    overview,
    nowMs,
    openId,
    open,
    detail: opened.detail,
    sendEvent: sources.sendEvent,
  };
}
