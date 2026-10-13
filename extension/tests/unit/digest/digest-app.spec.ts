// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
/**
 * The digest page on its live reads (entrypoints/digest/App.tsx and use-digests.ts `LIVE_DIGESTS`; sprint_4 close, QA
 * review GAP 14): the page's own connection to the ledger lists the stored weeks and shows the newest, as the service
 * worker saved it; and a read that fails is said on the page and logged as `digest.read_failed`, never left blank (Hard
 * Rule 6). Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { App } from '../../../entrypoints/digest/App';
import { DigestPage } from '../../../entrypoints/digest/components/DigestPage';
import { buildDigest, saveDigest } from '../../../src/ledger/digest';
import { lastWeek } from '../../../src/ledger/digest-week';
import { getLedger } from '../../../src/ledger/repo';
import { IsoTs } from '../../../src/ledger/types';
import { type LogRecord, setLogSink } from '../../../src/log';
import { deleteLedger } from '../../../src/ledger/shared';

let root: HTMLElement;
let records: LogRecord[];

beforeEach(() => {
  fakeBrowser.reset();
  root = document.createElement('div');
  document.body.append(root);
  records = [];
  setLogSink((record) => records.push(record));
});

afterEach(async () => {
  render(null, root);
  root.remove();
  await deleteLedger();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('the digest page’s live reads', () => {
  it('shows the newest week the ledger holds', async () => {
    const made = Date.parse('2026-10-12T09:00:00-04:00');
    const db = await getLedger();
    await saveDigest(db, await buildDigest(db, lastWeek(made), IsoTs.parse('2026-10-12T09:00:00-04:00')));
    await act(() => {
      render(h(App, null), root);
    });
    await settle();
    expect(root.querySelector('h1')?.textContent).toBe('Attest weekly digest');
    expect(root.querySelector('h2')?.textContent).toBe('Week of 5 Oct 2026');
  });

  it('says a read that failed, and logs it', async () => {
    const failing = {
      weeks: () => Promise.reject(new Error('closed')),
      digest: () => Promise.resolve(undefined),
      subscribe: () => () => undefined,
    };
    await act(() => {
      render(h(DigestPage, { sources: failing }), root);
    });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent.trim()).toBe(
      'Attest could not read its digests. Reload the page.',
    );
    expect(records.map(({ level, event }) => `${level}:${event}`)).toContain('error:digest.read_failed');
  });
});
