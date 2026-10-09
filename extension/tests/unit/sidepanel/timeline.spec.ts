// @vitest-environment happy-dom
/**
 * The side panel's timeline and detail (sprint_4 4.3; entrypoints/sidepanel), rendered with Preact in happy-dom over
 * stand-in sources: it reads the last 30 days of every agent and grade newest first; its filters combine (agents,
 * grades, days); older receipts come a page at a time; a change the service worker announces reads again as many
 * receipts as it shows; a receipt's detail shows every field that fed its score, and Back returns the focus to its row;
 * a person's mark needs a grade and a reason, is sent as a `receipt.event`, and a refusal is said in words. Every value
 * is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidePanel } from '../../../entrypoints/sidepanel/components/SidePanel';
import type { TimelineSources } from '../../../entrypoints/sidepanel/use-timeline';
import { TIMELINE_PAGE_SIZE } from '../../../src/config';
import {
  AgentId,
  Claim,
  Coverage,
  Grant,
  IsoTs,
  Receipt,
  type ReceiptInput,
  Sha256,
} from '../../../src/ledger/types';
import type { ReceiptDetail, ReceiptItem, ReceiptPage, TimelineFilters } from '../../../src/ui/data';
import { setLogSink } from '../../../src/log';
import { claimId, makeClaim, makeGrant, makeReceipt, sha, ulid } from '../ledger/fixtures';

const NOW = new Date(2026, 9, 9, 12, 0);
const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());

/** Receipt `n` of the 60 the stand-in ledger holds, newest first: every fifth NOT_FOUND, the rest VERIFIED. */
function item(n: number): ReceiptItem {
  const agent = AgentId.options[n % AgentId.options.length] ?? 'muse';
  const input: Partial<ReceiptInput> = {
    id: ulid(1000 - n),
    agent,
    claimId: claimId(n),
    inputsHash: sha(n),
    grade: n % 5 === 0 ? 'NOT_FOUND' : 'VERIFIED',
    state: 'FINAL',
    computedAt: iso(NOW.getTime() - n * 60_000),
    finalAt: iso(NOW.getTime() - n * 60_000),
  };
  const claim = Claim.parse(
    makeClaim({ rawHash: sha(n), agent, claimedAt: iso(NOW.getTime() - n * 60_000 - 120_000) }),
  );
  return { receipt: Receipt.parse(makeReceipt(input)), claim, orphan: undefined };
}

const LEDGER = Array.from({ length: 60 }, (_, n) => item(n));

/** The stand-in timeline read: the filters applied, a page at a time after the cursor. */
function pageOf(filters: TimelineFilters, after?: { id: string }, limit = TIMELINE_PAGE_SIZE): ReceiptPage {
  const kept = LEDGER.filter(
    ({ receipt }) =>
      filters.agents.includes(receipt.agent) && (filters.grades?.includes(receipt.grade) ?? true),
  );
  const start = after === undefined ? 0 : kept.findIndex(({ receipt }) => receipt.id === after.id) + 1;
  const items = kept.slice(start, start + limit);
  const last = items.at(-1);
  const next =
    start + limit < kept.length && last !== undefined
      ? { computedMs: Date.parse(last.receipt.computedAt), id: last.receipt.id }
      : null;
  return { items, next };
}

function detailOf(id: string, overrides: Partial<ReceiptInput> = {}): ReceiptDetail {
  const found = LEDGER.find(({ receipt }) => receipt.id === id) ?? LEDGER[0];
  if (found === undefined) throw new Error('empty ledger');
  const receipt = Receipt.parse({
    ...found.receipt,
    signals: { score: 0.92, timeProximity: 0.9 },
    ...overrides,
  });
  const coverage = Coverage.parse({
    evaluatedAt: receipt.computedAt,
    observers: [
      {
        observerId: 'gmail.sent',
        source: 'gmail.sent',
        lastSyncAt: receipt.computedAt,
        windowStart: iso(NOW.getTime() - 3_600_000),
        windowEnd: receipt.computedAt,
      },
      {
        observerId: 'gmail.receipt',
        source: 'gmail.receipt',
        lastSyncAt: receipt.computedAt,
        windowStart: receipt.computedAt,
        windowEnd: receipt.computedAt,
      },
    ],
  });
  const inputs = {
    coverage,
    grant: Grant.parse(makeGrant({ agent: receipt.agent })),
    context: { priorSpendCents: 0 },
    policyHash: Sha256.parse(sha(1)),
  };
  return { receipt, claim: found.claim, request: undefined, observations: [], inputs };
}

let root: HTMLElement;
let announce: () => void;
/** The detail the stand-in reads for a receipt (a test may change it). */
let detailFor: (id: string) => ReceiptDetail = (id) => detailOf(id);
let sources: TimelineSources & {
  page: ReturnType<typeof vi.fn<TimelineSources['page']>>;
  sendEvent: ReturnType<typeof vi.fn<TimelineSources['sendEvent']>>;
};

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  announce = () => undefined;
  detailFor = (id) => detailOf(id);
  sources = {
    page: vi.fn((filters: TimelineFilters, after?: { id: string }, limit?: number) =>
      Promise.resolve(pageOf(filters, after, limit)),
    ),
    overview: () =>
      Promise.resolve({ coverage: { coverage: [], imports: {} }, health: [], lastBatchMs: null }),
    receipt: (id: string) => Promise.resolve(detailFor(id)),
    sendEvent: vi.fn<TimelineSources['sendEvent']>(() => Promise.resolve({ ok: true })),
    subscribe: (_tables, onChange) => {
      announce = onChange;
      return () => undefined;
    },
    now: () => NOW,
  };
  setLogSink(() => undefined);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

async function show(): Promise<void> {
  await act(() => {
    render(h(SidePanel, { sources }), root);
  });
  await settle();
}

const rows = () => [...root.querySelectorAll('li[data-receipt]')];
const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);
const box = (label: string) =>
  [...root.querySelectorAll('label')].find((l) => l.textContent === label)?.querySelector('input');

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click');
  await act(() => {
    element.click();
  });
  await settle();
}

describe('the timeline', () => {
  it('reads the last 30 days of every agent and grade, newest first, and its filters combine', async () => {
    await show();
    expect(sources.page.mock.calls[0]).toEqual([
      { agents: AgentId.options, from: '2026-09-10', to: '2026-10-09' },
      undefined,
      TIMELINE_PAGE_SIZE,
    ]);
    expect(rows()).toHaveLength(TIMELINE_PAGE_SIZE);
    await click(box('Verified'));
    await click(box('Claude'));
    const date = root.querySelector<HTMLInputElement>('input[type="date"]');
    if (date === null) throw new Error('no date field');
    await act(() => {
      date.value = '2026-10-01';
      date.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(sources.page.mock.calls.at(-1)?.[0]).toEqual({
      agents: ['muse', 'chatgpt', 'dots'],
      grades: ['PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE'],
      from: '2026-10-01',
      to: '2026-10-09',
    });
    expect(rows().every((row) => row.textContent.includes('Grade: Not found'))).toBe(true);
  });

  it('shows older receipts a page at a time, and reads again as many as it shows when the ledger changes', async () => {
    await show();
    await click(button('Show older receipts'));
    expect(sources.page.mock.calls.at(-1)?.[1]).toEqual({
      computedMs: Date.parse(LEDGER[TIMELINE_PAGE_SIZE - 1]?.receipt.computedAt ?? ''),
      id: LEDGER[TIMELINE_PAGE_SIZE - 1]?.receipt.id,
    });
    expect(rows()).toHaveLength(60);
    expect(button('Show older receipts')).toBeUndefined();
    await act(() => {
      announce();
    });
    await settle();
    expect(sources.page.mock.calls.at(-1)?.[2]).toBe(60);
    expect(rows()).toHaveLength(60);
  });

  it('says a read that failed', async () => {
    sources.page.mockRejectedValue(new Error('blocked'));
    await show();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'Attest could not read its records. Close the panel and open it again.',
    );
  });
});

describe('a receipt’s detail', () => {
  it('shows every field that fed its score, and Back returns the focus to its row', async () => {
    await show();
    const id = LEDGER[2]?.receipt.id ?? '';
    await click(root.querySelector(`li[data-receipt="${id}"] button`));
    const headings = [...root.querySelectorAll('h2, h3')].map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Receipt',
      'What the agent said',
      'Evidence',
      'How it was graded',
      'What the grading read',
      'Mark it yourself',
    ]);
    const terms = [...root.querySelectorAll('dt')].map((term) => term.textContent);
    expect(terms).toEqual(
      expect.arrayContaining(['To', 'When it says', 'Read by', 'Score', 'Signal: Time', 'Rule', 'May do']),
    );
    expect(root.querySelector('details summary')?.textContent).toBe('2 coverage entries');
    expect(document.activeElement?.textContent).toBe('Receipt');
    await click(button('Back to the timeline'));
    expect(document.activeElement?.closest('li')?.getAttribute('data-receipt')).toBe(id);
  });
});

describe('a person’s mark on a receipt', () => {
  it('marks it with a grade and a required reason, and says when it was not saved', async () => {
    await show();
    await click(rows()[0]?.querySelector('button'));
    await click(button('Save my mark'));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Choose Verified or Not found.');
    await click(box('Not found: it did not happen'));
    await click(button('Save my mark'));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Say why, in a few words.');
    const why = root.querySelector('textarea');
    if (why === null) throw new Error('no reason field');
    await act(() => {
      why.value = 'I sent it myself';
      why.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Save my mark'));
    expect(sources.sendEvent).toHaveBeenCalledWith(LEDGER[0]?.receipt.id, {
      kind: 'override',
      grade: 'NOT_FOUND',
      reason: 'I sent it myself',
    });
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      'Saved. Attest’s own grade stays beside your mark.',
    );
  });

  it('undoes a mark, and says when its evidence now belongs to another claim', async () => {
    detailFor = (id) =>
      detailOf(id, {
        state: 'USER_OVERRIDDEN',
        override: {
          grade: 'NOT_FOUND',
          reason: 'I sent it myself',
          at: iso(NOW.getTime()),
          previousState: 'FINAL',
        },
        reasons: [
          ...(LEDGER[0]?.receipt.reasons ?? []),
          { code: 'override.user', params: { grade: 'NOT_FOUND' } },
        ],
      });
    sources.sendEvent.mockResolvedValue({ ok: false, code: 'evidence_taken' });
    await show();
    await click(rows()[0]?.querySelector('button'));
    expect(root.textContent).toContain('You marked it Not found: “I sent it myself”.');
    await click(button('Undo my mark'));
    expect(sources.sendEvent).toHaveBeenCalledWith(LEDGER[0]?.receipt.id, { kind: 'revert' });
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'Not undone: its evidence now belongs to another claim. Mark that claim instead.',
    );
  });
});
