// @vitest-environment happy-dom
/**
 * The side panel's reads land only while what they were for is current (sprint_4 close: tech review TECH-2, QA review
 * GAP 5; QA's red test, kept here green): a list read for filters since changed, a detail read for a receipt since
 * closed or replaced, and an older page for a list since read again are each dropped, so the newest state wins. Every
 * value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SidePanel } from '../../../entrypoints/sidepanel/components/SidePanel';
import type { OpenRequestStore } from '../../../entrypoints/sidepanel/use-open-request';
import type { TimelineSources } from '../../../entrypoints/sidepanel/use-timeline';
import { SESSION_KEYS } from '../../../src/config';
import { Claim, IsoTs, Receipt } from '../../../src/ledger/types';
import type { ReceiptDetail, ReceiptItem, ReceiptPage, TimelineFilters } from '../../../src/ui/data';
import { setLogSink } from '../../../src/log';
import { claimId, makeClaim, makeReceipt, sha, ulid } from '../ledger/fixtures';

const NOW = new Date(2026, 9, 9, 12, 0);
const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());

function item(n: number, grade: 'VERIFIED' | 'NOT_FOUND'): ReceiptItem {
  const at = iso(NOW.getTime() - n * 60_000);
  return {
    receipt: Receipt.parse(
      makeReceipt({
        id: ulid(1000 - n),
        claimId: claimId(n),
        inputsHash: sha(n),
        grade,
        state: 'FINAL',
        computedAt: at,
        finalAt: at,
      }),
    ),
    claim: Claim.parse(makeClaim({ rawHash: sha(n), claimedAt: iso(NOW.getTime() - n * 60_000 - 120_000) })),
    orphan: undefined,
  };
}

const LEDGER = [item(1, 'VERIFIED'), item(2, 'NOT_FOUND'), item(3, 'VERIFIED'), item(4, 'NOT_FOUND')];
const pageOf = (filters: TimelineFilters): ReceiptPage => ({
  items: LEDGER.filter(({ receipt }) => filters.grades?.includes(receipt.grade) ?? true),
  next: null,
});

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
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

it('shows only what the filters now ask, even when a read for the filters before them lands last', async () => {
  let releaseFirst: () => void = () => undefined;
  let calls = 0;
  const sources: TimelineSources = {
    page: (filters) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => {
            resolve(pageOf(filters));
          };
        });
      }
      return Promise.resolve(pageOf(filters));
    },
    overview: () =>
      Promise.resolve({ coverage: { coverage: [], imports: {} }, health: [], lastBatchMs: null }),
    receipt: () => Promise.resolve(undefined),
    sendEvent: () => Promise.resolve({ ok: true }),
    subscribe: () => () => undefined,
    now: () => NOW,
  };
  await act(() => {
    render(h(SidePanel, { sources }), root);
  });
  await settle();
  // The person unticks Verified while the first read (every grade) is still out.
  const verified = [...root.querySelectorAll('label')]
    .find((l) => l.textContent === 'Verified')
    ?.querySelector('input');
  await act(() => {
    verified?.click();
  });
  await settle();
  const grades = () =>
    [...root.querySelectorAll('li[data-receipt]')].map(
      (row) => /Grade: (Verified|Not found)/u.exec(row.textContent)?.[1],
    );
  expect(grades()).toEqual(['Not found', 'Not found']);
  // The first read lands last.
  await act(() => {
    releaseFirst();
  });
  await settle();
  expect(grades()).toEqual(['Not found', 'Not found']);
});

/** Sources whose `page`, `receipt` and `subscribe` a test drives by hand. */
function handSources(overrides: Partial<TimelineSources>): TimelineSources {
  return {
    page: (filters) => Promise.resolve(pageOf(filters)),
    overview: () =>
      Promise.resolve({ coverage: { coverage: [], imports: {} }, health: [], lastBatchMs: null }),
    receipt: () => Promise.resolve(undefined),
    sendEvent: () => Promise.resolve({ ok: true }),
    subscribe: () => () => undefined,
    now: () => NOW,
    ...overrides,
  };
}

const openButton = (index: number) =>
  [...root.querySelectorAll<HTMLButtonElement>('li[data-receipt] button')].filter(
    (b) => b.textContent === 'Open',
  )[index];
function detailOf(n: number): ReceiptDetail {
  const entry = LEDGER[n - 1];
  if (entry === undefined) throw new Error(`no receipt ${String(n)}`);
  return {
    receipt: entry.receipt,
    claim: entry.claim,
    observations: [],
    request: undefined,
    inputs: undefined,
  };
}

describe('a read that lands late', () => {
  it('for a receipt no longer open shows nothing of it: the detail open is the one shown', async () => {
    let releaseFirst: () => void = () => undefined;
    let first = true;
    const sources = handSources({
      receipt: (id) => {
        const n = LEDGER.findIndex(({ receipt }) => receipt.id === id) + 1;
        if (first) {
          first = false;
          return new Promise((resolve) => {
            releaseFirst = () => {
              resolve(detailOf(n));
            };
          });
        }
        return Promise.resolve(detailOf(n));
      },
    });
    // A clicked alert names a receipt to open (sprint_4 4.6) while another's detail is still being read.
    let requested: string | undefined;
    let named: () => void = () => undefined;
    const openRequests: OpenRequestStore = {
      get: () => Promise.resolve(requested === undefined ? {} : { [SESSION_KEYS.OPEN_RECEIPT]: requested }),
      remove: () => {
        requested = undefined;
        return Promise.resolve();
      },
      watch: (_key, onChange) => {
        named = onChange;
        return () => undefined;
      },
    };
    await act(() => {
      render(h(SidePanel, { sources, openRequests }), root);
    });
    await settle();
    await act(() => {
      openButton(0)?.click();
    });
    await settle();
    requested = LEDGER[1]?.receipt.id;
    await act(() => {
      named();
    });
    await settle();
    const shownId = () =>
      root
        .querySelector('section[aria-labelledby="detail-heading"] li[data-receipt]')
        ?.getAttribute('data-receipt');
    expect(shownId()).toBe(LEDGER[1]?.receipt.id);
    await act(() => {
      releaseFirst();
    });
    await settle();
    expect(shownId()).toBe(LEDGER[1]?.receipt.id);
  });
});

describe('a page that lands late', () => {
  it('for an older page of a list since read again leaves the fresh list as it is', async () => {
    let releaseMore: () => void = () => undefined;
    let announce: (changed?: readonly string[]) => void = () => undefined;
    let fresh = false;
    const sources = handSources({
      page: (filters, after) => {
        if (after !== undefined) {
          return new Promise((resolve) => {
            releaseMore = () => {
              resolve({ items: [item(9, 'VERIFIED')], next: null });
            };
          });
        }
        const items = fresh ? LEDGER.slice(0, 1) : LEDGER.slice(0, 2);
        return Promise.resolve({ items, next: fresh ? null : { computedMs: 0, id: 'x' } });
      },
      subscribe: (_tables, onChange) => {
        announce = onChange as typeof announce;
        return () => undefined;
      },
    });
    await act(() => {
      render(h(SidePanel, { sources }), root);
    });
    await settle();
    await act(() => {
      [...root.querySelectorAll('button')].find((b) => b.textContent === 'Show older receipts')?.click();
    });
    await settle();
    fresh = true;
    await act(() => {
      announce(['receipts']);
    });
    await settle();
    await act(() => {
      releaseMore();
    });
    await settle();
    expect(root.querySelectorAll('li[data-receipt]')).toHaveLength(1);
  });
});

describe('a change to what only the overview shows (TECH-7)', () => {
  it('reads only the overview', async () => {
    let pages = 0;
    let overviews = 0;
    let announce: (changed?: readonly string[]) => void = () => undefined;
    const sources = handSources({
      page: (filters) => {
        pages += 1;
        return Promise.resolve(pageOf(filters));
      },
      overview: () => {
        overviews += 1;
        return Promise.resolve({ coverage: { coverage: [], imports: {} }, health: [], lastBatchMs: null });
      },
      subscribe: (_tables, onChange) => {
        announce = onChange as typeof announce;
        return () => undefined;
      },
    });
    await act(() => {
      render(h(SidePanel, { sources }), root);
    });
    await settle();
    const before = { pages, overviews };
    await act(() => {
      announce(['coverage']);
    });
    await settle();
    expect(pages).toBe(before.pages);
    expect(overviews).toBe(before.overviews + 1);
  });
});
