// @vitest-environment happy-dom
/**
 * The pages that read content while the ledger is encrypted and locked (sprint_6 6.5: "unlock prompt in popup when
 * locked", and the same on every page that reads content): the side panel's timeline, the weekly digest and the
 * options page's grants each say the records are locked and offer the unlock, never "could not read" and never an
 * empty list; and none logs the lock as a failure. The popup's own state is tests/unit/popup/popup.spec.ts.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DigestPage } from '../../../entrypoints/digest/components/DigestPage';
import { GrantsSection } from '../../../entrypoints/options/components/GrantsSection';
import { TimelineList } from '../../../entrypoints/sidepanel/components/TimelineList';
import { LedgerError } from '../../../src/ledger/errors';
import { setLogSink, type LogRecord } from '../../../src/log';

const LOCKED_TEXT = 'Your records are encrypted and locked';
const locked = () => Promise.reject(new LedgerError('locked', 'The ledger is locked', { table: 'receipts' }));

let root: HTMLElement;
let records: LogRecord[];
let restore: () => void;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(() => {
  render(null, root);
  root.remove();
  restore();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function expectUnlockPrompt(toShow: string): void {
  expect(root.textContent).toContain(`${LOCKED_TEXT}. Type your passphrase to ${toShow}.`);
  expect(root.querySelector('input[type="password"]')).not.toBeNull();
  expect(root.textContent).not.toMatch(/could not read/iu);
  expect(records.filter((record) => record.level === 'error')).toEqual([]);
}

describe('a locked ledger', () => {
  it("in the side panel's timeline", async () => {
    await act(() => {
      render(
        h(TimelineList, {
          list: { status: 'locked' },
          nowMs: 0,
          lastBatchMs: null,
          onOpen: vi.fn(),
          onMore: vi.fn(),
          returnTo: null,
        }),
        root,
      );
    });
    expectUnlockPrompt('see your receipts');
  });

  it('on the weekly digest page', async () => {
    await act(() => {
      render(
        h(DigestPage, {
          sources: { weeks: locked, digest: locked, subscribe: () => () => undefined },
          nowMs: () => 0,
          share: {},
          // The privacy line's own read is not under test: a stand-in, every option off.
          privacy: {
            load: () => Promise.resolve({ byo: null, telemetry: false }),
            subscribe: () => () => undefined,
          },
        }),
        root,
      );
    });
    await settle();
    expectUnlockPrompt('see your weekly digests');
  });

  it("in the options page's grants", async () => {
    await act(() => {
      render(
        h(GrantsSection, {
          sources: { load: locked, save: vi.fn(), subscribe: () => () => undefined },
        }),
        root,
      );
    });
    await settle();
    expectUnlockPrompt('see and change the grants');
  });
});
