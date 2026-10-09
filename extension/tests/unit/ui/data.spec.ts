import 'fake-indexeddb/auto';
/**
 * The pages' reads (sprint_4 4.0; src/ui/data.ts): local days as ranges of instants in the page's own zone, the popup's
 * today from local midnight, the timeline's pages over its days and filters, the detail, coverage, health and grants
 * through the page's own connection to the ledger, and `ledger.changed` passed on for the tables a page shows. Every
 * assertion on a day holds in any time zone, a day of a clock change included.
 */
import { Dexie } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { DB_NAME, POPUP_RECEIPT_LIMIT, TIMELINE_PAGE_SIZE } from '../../../src/config';
import { closeLedger, getLedger, putAdapterHealth, putGrant, putReceipt } from '../../../src/ledger/repo';
import type { AgentId, Grade, ReceiptInput } from '../../../src/ledger/types';
import {
  loadCoverage,
  loadGrants,
  loadHealth,
  loadPopup,
  loadReceipt,
  loadTimelinePage,
  localDaysMs,
  localDayStartMs,
  onLedgerChanged,
} from '../../../src/ui/data';
import { serviceWorker } from '../bus/harness';
import { claimId, makeGrant, makeHealth, makeReceipt, omit, sha, ulid } from '../ledger/fixtures';

const HOUR = 3_600_000;

/** The local `YYYY-MM-DD` of an instant, in the zone the test runs in. */
function localDate(ms: number): string {
  const day = new Date(ms);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${String(day.getFullYear())}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

/** Receipt `n` of `agent` graded at the instant `ms`. */
function receiptAt(n: number, agent: AgentId, ms: number, grade: Grade = 'VERIFIED'): ReceiptInput {
  const base = makeReceipt({ id: ulid(n), agent, claimId: claimId(n), grade, inputsHash: sha(n) });
  const graded = { ...base, computedAt: new Date(ms).toISOString() };
  return grade === 'UNASKED' ? { ...omit(graded, 'claimId'), attribution: 'likely' } : graded;
}

async function store(receipts: readonly ReceiptInput[]): Promise<void> {
  const db = await getLedger();
  for (const receipt of receipts) await putReceipt(db, receipt);
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(async () => {
  await closeLedger();
  await Dexie.delete(DB_NAME);
});

describe('local days', () => {
  // Days around the clock changes of the northern and southern hemispheres, a leap day and a year's end.
  const DAYS = [
    '2026-03-08',
    '2026-03-29',
    '2026-04-05',
    '2026-10-04',
    '2026-10-25',
    '2026-11-01',
    '2028-02-29',
    '2026-12-31',
  ];

  it('runs each day from its first local instant to the last before the next day', () => {
    for (const day of DAYS) {
      const { fromMs, toMs } = localDaysMs(day, day);
      expect(localDate(fromMs), day).toBe(day);
      expect(localDate(fromMs - 1), day).not.toBe(day);
      expect(localDate(toMs), day).toBe(day);
      expect(localDate(toMs + 1), day).not.toBe(day);
      expect(localDayStartMs(fromMs + 12 * HOUR), day).toBe(fromMs);
      expect(localDayStartMs(toMs), day).toBe(fromMs);
    }
    const week = localDaysMs('2026-10-01', '2026-10-07');
    expect(week.fromMs).toBe(localDaysMs('2026-10-01', '2026-10-01').fromMs);
    expect(week.toMs).toBe(localDaysMs('2026-10-07', '2026-10-07').toMs);
  });

  it('gives an empty range for a date that does not parse', () => {
    expect(Number.isNaN(localDaysMs('soon', '2026-10-01').fromMs)).toBe(true);
    expect(Number.isNaN(localDaysMs('2026-10-01', '').toMs)).toBe(true);
  });
});

describe('the popup and the timeline', () => {
  it('lists the receipts graded since local midnight, newest first, with coverage, health and the last batch', async () => {
    const now = new Date(localDaysMs('2026-10-01', '2026-10-01').fromMs + 15 * HOUR);
    const midnight = localDayStartMs(now.getTime());
    await store([
      receiptAt(1, 'muse', midnight - 1),
      receiptAt(2, 'muse', midnight),
      receiptAt(3, 'claude', midnight + HOUR),
    ]);
    await putAdapterHealth(await getLedger(), makeHealth());
    const view = await loadPopup(now);
    expect(view.today.items.map(({ receipt }) => receipt.id)).toEqual([ulid(3), ulid(2)]);
    expect(view.today.next).toBeNull();
    expect(view.health.map(({ adapterId }) => adapterId)).toEqual(['muse']);
    expect(view.coverage).toEqual({ coverage: [], imports: {} });
    expect(view.lastBatchMs).toBeNull();
  });

  it(`shows at most ${String(POPUP_RECEIPT_LIMIT)} receipts in the popup, and pages the timeline ${String(TIMELINE_PAGE_SIZE)} at a time`, async () => {
    const start = localDaysMs('2026-10-01', '2026-10-01').fromMs;
    const count = Math.max(POPUP_RECEIPT_LIMIT, TIMELINE_PAGE_SIZE) + 5;
    await store(Array.from({ length: count }, (_, i) => receiptAt(i + 1, 'muse', start + i * 60_000)));
    const view = await loadPopup(new Date(start + 23 * HOUR));
    expect(view.today.items).toHaveLength(POPUP_RECEIPT_LIMIT);
    expect(view.today.next).not.toBeNull();
    const filters = { agents: ['muse'] as const, from: '2026-10-01', to: '2026-10-01' };
    const first = await loadTimelinePage(filters);
    expect(first.items).toHaveLength(TIMELINE_PAGE_SIZE);
    expect(first.next).not.toBeNull();
    const second = first.next === null ? null : await loadTimelinePage(filters, first.next);
    expect(second?.items).toHaveLength(count - TIMELINE_PAGE_SIZE);
    expect(second?.next).toBeNull();
  });
});

describe('the timeline filters', () => {
  it('filters the timeline by its days, agents and grades; a range that does not parse reads nothing', async () => {
    const day = (date: string) => localDaysMs(date, date).fromMs + 12 * HOUR;
    await store([
      receiptAt(1, 'muse', day('2026-09-30')),
      receiptAt(2, 'muse', day('2026-10-01'), 'NOT_FOUND'),
      receiptAt(3, 'claude', day('2026-10-02')),
      receiptAt(4, 'dots', day('2026-10-02'), 'UNASKED'),
      receiptAt(5, 'muse', day('2026-10-03')),
    ]);
    const ids = async (filters: Parameters<typeof loadTimelinePage>[0]) =>
      (await loadTimelinePage(filters)).items.map(({ receipt }) => receipt.id);
    const every: readonly AgentId[] = ['muse', 'chatgpt', 'dots', 'claude'];
    expect(await ids({ agents: every, from: '2026-10-01', to: '2026-10-02' })).toEqual([
      ulid(4),
      ulid(3),
      ulid(2),
    ]);
    expect(await ids({ agents: ['muse'], from: '2026-09-01', to: '2026-10-31' })).toEqual([
      ulid(5),
      ulid(2),
      ulid(1),
    ]);
    expect(
      await ids({ agents: every, grades: ['UNASKED', 'NOT_FOUND'], from: '2026-09-01', to: '2026-10-31' }),
    ).toEqual([ulid(4), ulid(2)]);
    expect(await ids({ agents: every, from: '2026-10-03', to: '2026-10-01' })).toEqual([]);
    expect(await ids({ agents: every, from: 'yesterday', to: '2026-10-01' })).toEqual([]);
  });
});

describe('the detail and the small tables', () => {
  it('reads a receipt, the coverage summary, the health reports and the grants', async () => {
    await store([receiptAt(1, 'muse', Date.parse('2026-10-01T12:00:00Z'))]);
    const db = await getLedger();
    await putGrant(db, makeGrant({ agent: 'claude' }));
    await putAdapterHealth(
      db,
      makeHealth({ adapterId: 'gmail', status: 'DEGRADED', reasons: ['selector_missing'] }),
    );
    expect((await loadReceipt(ulid(1)))?.receipt.id).toBe(ulid(1));
    expect(await loadReceipt(ulid(2))).toBeUndefined();
    expect(await loadCoverage()).toEqual({ coverage: [], imports: {} });
    expect((await loadHealth()).map(({ adapterId, status }) => [adapterId, status])).toEqual([
      ['gmail', 'DEGRADED'],
    ]);
    expect((await loadGrants()).map(({ agent }) => agent)).toEqual(['claude']);
  });
});

describe('onLedgerChanged', () => {
  /** Lets the listener's module load and register (it loads after the page's start). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('reads once when it starts listening, then passes on each change to the tables a page shows', async () => {
    const onChange = vi.fn();
    const addListener = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');
    const stop = onLedgerChanged(['receipts', 'coverage'], onChange);
    await vi.waitFor(() => {
      expect(addListener).toHaveBeenCalledTimes(1);
    });
    const listener = addListener.mock.calls[0]?.[0];
    if (listener === undefined) throw new Error('no listener registered');
    // Once listening, one catch-up call with every table watched: a change announced before it listened is read too.
    expect(onChange.mock.calls).toEqual([[['receipts', 'coverage']]]);
    const announce = (tables: readonly string[]) => {
      listener(
        { type: 'ledger.changed', tables, at: '2026-10-01T12:00:00Z' },
        serviceWorker(),
        () => undefined,
      );
    };
    announce(['receipts', 'meta']);
    announce(['claims']);
    expect(onChange.mock.calls.slice(1)).toEqual([[['receipts']]]);
    stop();
    expect(fakeBrowser.runtime.onMessage.hasListener(listener)).toBe(false);
  });

  it('never listens when stopped before its listener loaded', async () => {
    const onChange = vi.fn();
    const addListener = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');
    const stop = onLedgerChanged(['receipts'], onChange);
    stop();
    await settle();
    await settle();
    expect(addListener).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
