/**
 * The side panel's timeline (sprint_4 4.3): its filters, the receipts they select a page at a time (src/ui/data.ts
 * `loadTimelinePage`, newest first), the overview above them, and the receipt whose detail is open. When the service
 * worker announces a change, the panel reads again as many receipts as it shows, so its list keeps its place, and the
 * open detail too. Reads never overlap: one asked for during a read runs once after it. A read that fails is said and
 * logged (Hard Rule 6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import type { LedgerTable, ReceiptEventMessage, ReceiptEventResult } from '../../src/bus/messages';
import { sendReceiptEvent } from '../../src/bus/send';
import { TIMELINE_PAGE_SIZE } from '../../src/config';
import { AgentId } from '../../src/ledger/types';
import { log } from '../../src/log';
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
  readonly subscribe: (tables: readonly LedgerTable[], onChange: () => void) => () => void;
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

/** The tables the side panel shows something of. */
export const TIMELINE_TABLES: readonly LedgerTable[] = [
  'receipts',
  'claims',
  'observations',
  'requests',
  'coverage',
  'adapterHealth',
  'meta',
];

/** The days a new timeline shows: the last 30, today included. */
export const DEFAULT_DAYS = 30;

const dateOf = (ms: number): string => {
  const day = new Date(ms);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${String(day.getFullYear())}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
};

/** Every agent and grade, over the last DEFAULT_DAYS local days ending today. */
export function defaultFilters(now: Date): TimelineFilters {
  const today = localDayStartMs(now.getTime());
  const from = new Date(today);
  from.setDate(from.getDate() - (DEFAULT_DAYS - 1));
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

/** Runs `read` with no two at once: a call during a read runs it once more after it. */
function serial(read: () => Promise<void>): () => void {
  let running = false;
  let again = false;
  // Read through a call: a call during the await sets it, which the type checker cannot see.
  const asked = (): boolean => again;
  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await read();
      } while (asked());
    } finally {
      running = false;
    }
  };
  return () => {
    void run();
  };
}

interface ReceiptList {
  readonly list: ListState;
  readonly overview: SidePanelOverview | null;
  readonly nowMs: number;
  readonly reread: () => void;
  readonly loadMore: () => void;
}

/** The receipts `filters` select, a page at a time, and the overview above them (header). */
function useReceiptList(sources: TimelineSources, filters: TimelineFilters): ReceiptList {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [overview, setOverview] = useState<SidePanelOverview | null>(null);
  const [nowMs, setNowMs] = useState(() => sources.now().getTime());
  // How many receipts the list shows, read when a read starts: a change reads again as many.
  const shown = useRef(0);
  shown.current = list.status === 'ready' ? list.items.length : 0;
  const reread = useMemo(
    () =>
      serial(async () => {
        setNowMs(sources.now().getTime());
        try {
          const limit = Math.max(TIMELINE_PAGE_SIZE, shown.current);
          const [page, top] = await Promise.all([
            sources.page(filters, undefined, limit),
            sources.overview(),
          ]);
          setList({ status: 'ready', items: page.items, next: page.next, more: 'idle' });
          setOverview(top);
        } catch (error) {
          log.error('sidepanel.read_failed', { error });
          setList({ status: 'failed' });
        }
      }),
    [sources, filters],
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
    setList({ ...list, more: 'loading' });
    sources.page(filters, next).then(
      (page) => {
        setList({ status: 'ready', items: [...items, ...page.items], next: page.next, more: 'idle' });
      },
      (error: unknown) => {
        log.error('sidepanel.read_failed', { error });
        setList({ ...list, more: 'failed' });
      },
    );
  }, [filters, list, sources]);
  return { list, overview, nowMs, reread, loadMore };
}

/** The detail of the receipt `openId`, read again by `reread` (header). */
function useReceiptDetail(
  sources: TimelineSources,
  openId: string | null,
): { readonly detail: Timeline['detail']; readonly reread: () => void } {
  const [detail, setDetail] = useState<Timeline['detail']>(undefined);
  const reread = useMemo(
    () =>
      serial(async () => {
        if (openId === null) return;
        try {
          setDetail(await sources.receipt(openId));
        } catch (error) {
          log.error('sidepanel.read_failed', { error });
          setDetail('failed');
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
  // One subscription for the panel's life, reading the latest list and detail on each change.
  const latest = useRef({ list: receipts.reread, detail: opened.reread });
  latest.current = { list: receipts.reread, detail: opened.reread };
  useEffect(
    () =>
      sources.subscribe(TIMELINE_TABLES, () => {
        latest.current.list();
        latest.current.detail();
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
