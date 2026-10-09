// @vitest-environment happy-dom
/**
 * The weekly digest page (sprint_4 4.7; entrypoints/digest/), rendered with Preact in happy-dom over stand-in reads:
 * the newest week, each agent's stored counts and verified-of-checked, the receipts to look at ("Likely agent" on an
 * UNASKED one), the days not checked and the readers; another week chosen; the share shown in full before it is copied,
 * and said when copied; before the first Monday, what will come. Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DigestPage } from '../../../entrypoints/digest/components/DigestPage';
import type { DigestSources } from '../../../entrypoints/digest/use-digests';
import { DigestRecord } from '../../../src/ledger/types';
import { setLogSink } from '../../../src/log';
import { digestMarkdown } from '../../../src/ui/digest-share';

const ZERO = { VERIFIED: 0, PARTIAL: 0, NOT_FOUND: 0, UNASKED: 0, OVER_SCOPE: 0, UNVERIFIABLE: 0 };

const digestOf = (week: string, verified: number): DigestRecord =>
  DigestRecord.parse({
    week,
    from: `${week}T00:00:00.000-04:00`,
    to: '2026-10-12T00:00:00.000-04:00',
    createdAt: '2026-10-12T09:00:00.000-04:00',
    agents: [
      {
        agent: 'muse',
        grades: { ...ZERO, VERIFIED: verified, UNASKED: 1 },
        checking: 2,
        marked: 0,
        checked: 5,
        verified,
      },
    ],
    notable: [
      {
        receiptId: '01JA0000000000000000000003',
        agent: 'muse',
        grade: 'UNASKED',
        type: 'email.sent',
        at: '2026-10-06T14:03:00-04:00',
        domain: 'supplier.example',
      },
    ],
    notableCount: 1,
    gaps: [{ source: 'gcal.event', days: ['2026-10-06', '2026-10-07', '2026-10-08'] }],
    health: [
      {
        adapterId: 'gmail.sent',
        version: '1.4.0',
        status: 'OK',
        reasons: [],
        checkedAt: '2026-10-11T18:00:00-04:00',
      },
    ],
  });

const LATEST = digestOf('2026-10-05', 4);
const DIGESTS: Record<string, DigestRecord> = {
  '2026-10-05': LATEST,
  '2026-09-28': digestOf('2026-09-28', 2),
};

let root: HTMLElement;
let sources: DigestSources;
let copy: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  sources = {
    weeks: () => Promise.resolve(Object.keys(DIGESTS).sort().reverse()),
    digest: (week) => Promise.resolve(DIGESTS[week]),
    subscribe: () => () => undefined,
  };
  copy = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  setLogSink(() => undefined);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function show(page: DigestSources = sources): Promise<void> {
  await act(() => {
    render(
      h(DigestPage, { sources: page, nowMs: () => Date.parse('2026-10-12T10:00:00-04:00'), copy }),
      root,
    );
  });
  await settle();
}

const button = (name: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);

describe('the digest page', () => {
  it('shows the newest week as stored: counts, verified of checked, what to look at, gaps and readers', async () => {
    await show();
    const text = root.textContent;
    expect(root.querySelector('h2')?.textContent).toBe('Week of 5 Oct 2026');
    expect(text).toContain('4 of 5 checked claims verified.');
    expect(text).toContain('2 still checking.');
    expect(text).toContain('Likely agent');
    expect(text).toContain('Email sent, 6 Oct 2026, 14:03, supplier.example');
    expect(text).toContain('Calendar was not checked Tue–Thu.');
    expect(text).toContain('Gmail Sent reader: working, version 1.4.0.');
    expect(text).not.toContain('@');
  });

  it('reads another week when chosen', async () => {
    await show();
    const select = root.querySelector('select');
    if (select === null) throw new Error('no week picker');
    await act(() => {
      select.value = '2026-09-28';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(root.querySelector('h2')?.textContent).toBe('Week of 28 Sep 2026');
    expect(root.textContent).toContain('2 of 5 checked claims verified.');
  });

  it('shows the share in full before it is copied, and says when it was', async () => {
    await show();
    await act(() => {
      button('Share this week')?.click();
    });
    expect(root.querySelector('pre')?.textContent).toBe(digestMarkdown(LATEST));
    await act(() => {
      button('Copy')?.click();
    });
    await settle();
    expect(copy).toHaveBeenCalledWith(digestMarkdown(LATEST));
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Copied.');
  });

  it('says what will come before the first Monday', async () => {
    await show({ ...sources, weeks: () => Promise.resolve([]) });
    expect(root.textContent).toContain('Attest makes your first weekly digest on Monday at 09:00');
    expect(root.querySelector('select')).toBeNull();
  });
});
