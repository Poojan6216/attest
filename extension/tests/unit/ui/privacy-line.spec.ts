// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
/**
 * What the pages say leaves the browser (Sprint 5 close, security review SEC-1; Hard Rule 1; src/ui/privacy-text.ts,
 * privacy-data.ts, PrivacyLine.tsx). "Nothing leaves your browser." only while both options that send are off; with the
 * person's own key on and saved, its vendor named; with the usage numbers on, they are named; with both, both. Until
 * the choices are read, or when they cannot be, the sentence true whatever they are. The line follows a change. The
 * choices come from the ledger's flags and the saved vendor, never the key. Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { STORAGE_KEYS } from '../../../src/config';
import { saveFlag } from '../../../src/ledger/consent';
import { closeLedger, getLedger } from '../../../src/ledger/shared';
import { setLogSink, type LogRecord } from '../../../src/log';
import { loadPrivacy, onPrivacyChanged, type PrivacySources } from '../../../src/ui/privacy-data';
import {
  PRIVACY_NOTHING,
  PRIVACY_UNKNOWN,
  privacyLines,
  type PrivacyState,
} from '../../../src/ui/privacy-text';
import { PrivacyLine } from '../../../src/ui/PrivacyLine';

const KEY = 'sk-ant-invented-privacy-0123456789';
const BYO_ON = 'Your own model key is on: facts of partial matches go to Anthropic.';
const NUMBERS_ON = 'Usage numbers are on: counts go to Attest’s server once a day.';

let root: HTMLElement;
let records: LogRecord[];
let restore: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  root = document.createElement('div');
  document.body.append(root);
  records = [];
  restore = setLogSink((record) => records.push(record));
});

afterEach(async () => {
  render(null, root);
  root.remove();
  restore();
  await closeLedger();
});

describe('privacyLines', () => {
  it('says nothing leaves only while both options that send are off', () => {
    expect(privacyLines({ byo: null, telemetry: false })).toEqual([PRIVACY_NOTHING]);
    expect(PRIVACY_NOTHING).toBe('Nothing leaves your browser.');
  });

  it('names each option that is on, and what it sends where', () => {
    expect(privacyLines({ byo: 'anthropic', telemetry: false })).toEqual([BYO_ON]);
    expect(privacyLines({ byo: 'openai', telemetry: false })).toEqual([
      'Your own model key is on: facts of partial matches go to OpenAI.',
    ]);
    expect(privacyLines({ byo: null, telemetry: true })).toEqual([NUMBERS_ON]);
    expect(privacyLines({ byo: 'anthropic', telemetry: true })).toEqual([BYO_ON, NUMBERS_ON]);
  });

  it('says what is true whatever was chosen while the choices are unknown', () => {
    expect(privacyLines(null)).toEqual([
      'Nothing leaves your browser unless you turn on an option that sends.',
    ]);
  });
});

/** Sources whose choices the test sets, with the page's change callback in hand. */
function settable(initial: PrivacyState) {
  let state = initial;
  let changed: () => void = () => undefined;
  const sources: PrivacySources = {
    load: () => Promise.resolve(state),
    subscribe: (onChange) => {
      changed = onChange;
      return () => undefined;
    },
  };
  return {
    sources,
    set: (next: PrivacyState) => {
      state = next;
      changed();
    },
  };
}

describe('PrivacyLine', () => {
  it('says the unknown sentence before its read, then the choices, and follows a change', async () => {
    const { sources, set } = settable({ byo: null, telemetry: false });
    render(h(PrivacyLine, { sources, class: 'line' }), root);
    expect(root.textContent).toBe(PRIVACY_UNKNOWN);
    await vi.waitFor(() => {
      expect(root.textContent).toBe(PRIVACY_NOTHING);
    });
    await act(() => {
      set({ byo: 'anthropic', telemetry: true });
    });
    await vi.waitFor(() => {
      expect(root.textContent).toBe(`${BYO_ON} ${NUMBERS_ON}`);
    });
  });

  it('keeps the unknown sentence, and says why in the log, when the choices cannot be read', async () => {
    const sources: PrivacySources = {
      load: () => Promise.reject(new Error('unreadable')),
      subscribe: () => () => undefined,
    };
    await act(async () => {
      render(h(PrivacyLine, { sources, class: 'line' }), root);
      await Promise.resolve();
    });
    expect(root.textContent).toBe(PRIVACY_UNKNOWN);
    expect(records.map((record) => record.event)).toContain('privacy.read_failed');
  });
});

describe('loadPrivacy', () => {
  it('reads the flags and the saved vendor, never the key', async () => {
    expect(await loadPrivacy()).toEqual({ byo: null, telemetry: false });
    const db = await getLedger();
    await saveFlag(db, 'ATTEST_MODEL_BYO', true);
    // On, but no key saved: nothing can go.
    expect(await loadPrivacy()).toEqual({ byo: null, telemetry: false });
    await browser.storage.local.set({ [STORAGE_KEYS.BYO_KEY]: KEY, [STORAGE_KEYS.BYO_VENDOR]: 'anthropic' });
    await saveFlag(db, 'ATTEST_TELEMETRY', true);
    const get = vi.spyOn(browser.storage.local, 'get');
    expect(await loadPrivacy()).toEqual({ byo: 'anthropic', telemetry: true });
    expect(get.mock.calls).toEqual([[STORAGE_KEYS.BYO_VENDOR]]);
    // Saved, but off: nothing goes.
    await saveFlag(db, 'ATTEST_MODEL_BYO', false);
    expect(await loadPrivacy()).toEqual({ byo: null, telemetry: true });
  });

  it('is told when the saved vendor changes, and no longer once unsubscribed', async () => {
    const onChange = vi.fn();
    const off = onPrivacyChanged(onChange);
    await browser.storage.local.set({ [STORAGE_KEYS.BYO_VENDOR]: 'openai' });
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    off();
    onChange.mockClear();
    await browser.storage.local.set({ [STORAGE_KEYS.BYO_VENDOR]: 'anthropic' });
    await browser.storage.local.set({ unrelated: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
