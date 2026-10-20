// @vitest-environment happy-dom
/**
 * The popup (sprint_4 4.2; entrypoints/popup), rendered with Preact in happy-dom over stand-in sources: skeleton rows
 * while the ledger is read; then the degraded banner, the coverage header and today's receipts newest first, an
 * UNASKED row saying "Likely agent" with its signals, a PENDING row saying from when it can be final, an UNVERIFIABLE
 * row with its reason; a clear empty state for a day with none; a read that fails said and logged; an encrypted ledger
 * that is locked asking for its passphrase, never said as a failure (sprint_6 6.5); a change the service
 * worker announces read again, overlapping changes in one more read; and the two links: the timeline opens in this
 * window's side panel, the settings in their page. Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { Popup } from '../../../entrypoints/popup/components/Popup';
import type { PopupSources } from '../../../entrypoints/popup/use-popup-view';
import {
  AdapterHealth,
  Claim,
  IsoTs,
  Observation,
  Receipt,
  type ReceiptInput,
} from '../../../src/ledger/types';
import type { PopupView } from '../../../src/ui/data';
import { LedgerError } from '../../../src/ledger/errors';
import { setLogSink, type LogRecord } from '../../../src/log';
import { makeClaim, makeObservation, makeReceipt, omit, ulid } from '../ledger/fixtures';

const NOW = new Date(2026, 9, 1, 12, 0);
const MINUTE = 60_000;
const iso = (ms: number) => IsoTs.parse(new Date(ms).toISOString());

function receipt(n: number, overrides: Partial<ReceiptInput>): Receipt {
  return Receipt.parse(
    makeReceipt({ id: ulid(n), computedAt: iso(NOW.getTime() - n * MINUTE), ...overrides }),
  );
}

function view(items: PopupView['today']['items'], health: AdapterHealth[] = []): PopupView {
  return {
    today: { items, next: null },
    coverage: { coverage: [], imports: {} },
    health,
    lastBatchMs: NOW.getTime() - MINUTE,
    autoCheck: null,
  };
}

function day(): PopupView {
  const pending = receipt(1, { finalFrom: iso(NOW.getTime() + 30 * MINUTE) });
  const calendar = receipt(2, {
    grade: 'UNVERIFIABLE',
    state: 'FINAL',
    finalAt: iso(NOW.getTime() - 2 * MINUTE),
    observationIds: [],
    reasons: [{ code: 'coverage.none', params: { source: 'gcal.event' } }],
  });
  const unasked = Receipt.parse({
    ...omit(
      makeReceipt({ id: ulid(3), grade: 'UNASKED', computedAt: iso(NOW.getTime() - 3 * MINUTE) }),
      'claimId',
    ),
    attribution: 'likely',
    state: 'FINAL',
    finalAt: iso(NOW.getTime() - 3 * MINUTE),
    reasons: [{ code: 'unasked.session', params: { agent: 'muse' } }],
  });
  const orphan = Observation.parse(makeObservation({ occurredAt: iso(NOW.getTime() - 60 * MINUTE) }));
  return view([
    { receipt: pending, claim: Claim.parse(makeClaim()), orphan: undefined },
    {
      receipt: calendar,
      claim: Claim.parse(makeClaim({ type: 'calendar.created', counterparty: 'sam@example.com' })),
      orphan: undefined,
    },
    { receipt: unasked, claim: undefined, orphan },
  ]);
}

let root: HTMLElement;
let records: LogRecord[];
let restoreSink: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  root = document.createElement('div');
  document.body.append(root);
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
  vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: 7 } as never);
});

afterEach(() => {
  render(null, root);
  root.remove();
  restoreSink();
});

/** Stand-in sources: `load` answers from `views` in turn; `changed()` announces a change to the popup. */
function sources(...views: (PopupView | Error)[]) {
  let announce: () => void = () => undefined;
  const load = vi.fn((): Promise<PopupView> => {
    const next = views.length > 1 ? views.shift() : views[0];
    return next instanceof Error || next === undefined
      ? Promise.reject(next ?? new Error('no view'))
      : Promise.resolve(next);
  });
  const subscribe = vi.fn((_tables: unknown, onChange: () => void) => {
    announce = onChange;
    return vi.fn();
  });
  const given: PopupSources = { load, subscribe, now: () => NOW };
  const changed = (): void => {
    announce();
  };
  return { given, load, subscribe, changed };
}

async function show(given: PopupSources): Promise<void> {
  await act(async () => {
    render(h(Popup, { sources: given }), root);
    await Promise.resolve();
  });
}

describe('the popup', () => {
  it("draws skeleton rows while it reads, then the day's receipts newest first", async () => {
    let finish: (value: PopupView) => void = () => undefined;
    const slow: PopupSources = {
      load: () => new Promise((resolve) => (finish = resolve)),
      subscribe: () => () => undefined,
      now: () => NOW,
    };
    await show(slow);
    expect(root.querySelector('[role="status"][aria-busy="true"]')?.textContent).toBe(
      "Loading today's receipts",
    );
    await act(async () => {
      finish(day());
      await Promise.resolve();
    });
    const rows = [...root.querySelectorAll('li[data-receipt]')];
    expect(rows.map((row) => row.getAttribute('data-receipt'))).toEqual([ulid(1), ulid(2), ulid(3)]);
    expect(rows[0]?.textContent).toContain('Checking: final from 12:30');
    expect(rows[1]?.textContent).toContain(
      "Attest did not see Google Calendar during this claim's time window.",
    );
    expect(rows[2]?.textContent).toContain('Likely agent: Muse');
    expect(rows[2]?.querySelector('details summary')?.textContent).toBe('Why likely: 1 signal');
    expect(root.textContent).toContain('Calendar not checked yet');
  });
});

describe('the popup when the day is empty, the read fails, or the ledger changes', () => {
  it('says a day with no receipts in words, and shows the degraded banner whatever the day holds', async () => {
    const degraded = AdapterHealth.parse({
      adapterId: 'gcal.event',
      version: '1.5.0',
      status: 'DEGRADED',
      reasons: [],
      checkedAt: iso(NOW.getTime()),
    });
    await show(sources(view([], [degraded])).given);
    expect(root.querySelector('[role="status"]')?.textContent).toContain('No receipts today');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Degraded: Calendar reader 1.5.0');
  });

  it('says a read that failed and logs it, never showing an empty day', async () => {
    await show(sources(new Error('blocked')).given);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'Attest could not read its records. Close the popup and open it again.',
    );
    expect(root.textContent).not.toContain('No receipts today');
    expect(records.map(({ event }) => event)).toContain('popup.read_failed');
  });

  it('asks for the passphrase while the ledger is encrypted and locked, and reads again once it is not', async () => {
    const stand = sources(new LedgerError('locked', 'The ledger is locked', { table: 'receipts' }), view([]));
    await show(stand.given);
    // The prompt loads when the ledger is first found locked (tech review TECH-1).
    await vi.waitFor(() => {
      expect(root.textContent).toContain('Your records are encrypted and locked');
    });
    expect(root.querySelector('input[type="password"]')).not.toBeNull();
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).not.toContain('No receipts today');
    expect(records.map(({ event }) => event)).not.toContain('popup.read_failed');
    await act(async () => {
      stand.changed();
      await Promise.resolve();
    });
    expect(stand.load).toHaveBeenCalledTimes(2);
    expect(root.textContent).toContain('No receipts today');
  });

  it('reads again when the service worker announces a change', async () => {
    const stand = sources(view([]), day());
    await show(stand.given);
    expect(stand.subscribe).toHaveBeenCalledWith(
      ['receipts', 'claims', 'observations', 'coverage', 'adapterHealth', 'meta'],
      expect.any(Function),
    );
    await act(async () => {
      stand.changed();
      await Promise.resolve();
    });
    expect(stand.load).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('li[data-receipt]')).toHaveLength(3);
  });
});

describe('the popup after the Gmail auto-check opened Gmail (sprint_4 4.9)', () => {
  const opened = (atMs: number): PopupView => ({
    ...view([]),
    autoCheck: {
      at: IsoTs.parse(new Date(atMs).toISOString()),
      until: IsoTs.parse(new Date(atMs + 30 * MINUTE).toISOString()),
      claims: 1,
      agents: ['muse'],
    },
  });
  const notice = () =>
    [...root.querySelectorAll('[role="status"]')].find(({ textContent }) =>
      textContent.includes('Gmail Sent folder'),
    );

  it('says why the tab opened, until its window ends', async () => {
    await show(sources(opened(NOW.getTime() - 10 * MINUTE)).given);
    expect(notice()?.textContent).toBe(
      'At 11:50 Attest opened your Gmail Sent folder in a pinned tab, to check an email Muse says it sent: ' +
        'Attest had not seen the folder since. It only reads the folder. Close the tab whenever you like, or turn ' +
        'this off in Options.',
    );
  });

  it('says nothing once the window has ended', async () => {
    await show(sources(opened(NOW.getTime() - 30 * MINUTE)).given);
    expect(notice()).toBeUndefined();
  });
});

describe("the popup's links", () => {
  it("opens the timeline in this window's side panel, and the settings page", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    Reflect.set(fakeBrowser.sidePanel, 'open', open);
    const options = vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    await show(sources(view([])).given);
    const button = (label: string) =>
      [...root.querySelectorAll('button')].find(
        (candidate) => candidate.getAttribute('aria-label') === label,
      );
    await act(async () => {
      button('Open timeline')?.click();
      await Promise.resolve();
    });
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
    await act(async () => {
      button('Open settings')?.click();
      await Promise.resolve();
    });
    expect(options).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('says when Chrome refuses, and logs it', async () => {
    Reflect.set(fakeBrowser.sidePanel, 'open', vi.fn().mockRejectedValue(new Error('no gesture')));
    await show(sources(view([])).given);
    await act(async () => {
      [...root.querySelectorAll('button')]
        .find((b) => b.getAttribute('aria-label') === 'Open timeline')
        ?.click();
      await Promise.resolve();
    });
    expect(root.querySelector('nav [role="alert"]')?.textContent).toBe('Chrome did not open it. Try again.');
    expect(records.map(({ event }) => event)).toContain('popup.side_panel_failed');
  });
});
