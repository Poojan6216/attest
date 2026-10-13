import 'fake-indexeddb/auto';
/**
 * The usage numbers the options page shows (sprint_5 5.7; entrypoints/options/telemetry-preview.ts; Sprint 5 close,
 * security review SEC-8): the last whole day's payload, built with the service worker's builder from the page's own
 * ledger connection, and whether that day was sent; no payload while no valid install id is stored, and none is made.
 * The page is told to read again when the install id changes or is removed, and just after each midnight; the
 * unsubscribe stops both. Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import {
  onTelemetryChanged,
  previewTelemetry,
  untilMidnight,
} from '../../../entrypoints/options/telemetry-preview';
import { STORAGE_KEYS } from '../../../src/config';
import { deleteLedger, getLedger } from '../../../src/ledger/shared';
import { recordTelemetrySent } from '../../../src/ledger/telemetry-sent';
import { fakeStorageBuckets } from '../storage-buckets-setup';

const ID = '4f1c2b3a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const NOW = new Date(2026, 9, 10, 9, 30).getTime();

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

beforeEach(() => {
  fakeBrowser.reset();
  // The facts a page reads: the extension's version, and Chrome's from its user agent (src/telemetry/facts.ts).
  vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({
    manifest_version: 3,
    name: 'Attest',
    version: '0.1.0',
  });
  vi.stubGlobal('navigator', { userAgent: USER_AGENT, storageBuckets: fakeStorageBuckets });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await deleteLedger();
});

describe('previewTelemetry', () => {
  it('builds the last whole day with the stored install id, and says whether that day was sent', async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_ID]: ID });
    const before = await previewTelemetry(NOW);
    expect(before).toMatchObject({
      day: '2026-10-09',
      sent: false,
      payload: { installId: ID, dayBucket: '2026-10-09', chromeMajor: 141 },
    });
    await recordTelemetrySent(await getLedger(), '2026-10-09');
    expect(await previewTelemetry(NOW)).toMatchObject({ day: '2026-10-09', sent: true });
    // The next day's numbers are not sent yet.
    expect(await previewTelemetry(NOW + 86_400_000)).toMatchObject({ day: '2026-10-10', sent: false });
  });

  it('has no payload while no valid install id is stored, and makes none', async () => {
    expect(await previewTelemetry(NOW)).toEqual({ day: '2026-10-09', payload: null, sent: false });
    await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_ID]: 'not-an-id' });
    expect((await previewTelemetry(NOW)).payload).toBeNull();
    expect(await browser.storage.local.get(STORAGE_KEYS.INSTALL_ID)).toEqual({
      [STORAGE_KEYS.INSTALL_ID]: 'not-an-id',
    });
  });
});

describe('onTelemetryChanged', () => {
  it('tells the page when the install id changes or is removed, and no more once unsubscribed', async () => {
    const onChange = vi.fn();
    const off = onTelemetryChanged(onChange, () => NOW);
    await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_ID]: 'not-an-id' });
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    off();
    onChange.mockClear();
    await browser.storage.local.remove(STORAGE_KEYS.INSTALL_ID);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tells the page just after each midnight, when the last whole day changes', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const off = onTelemetryChanged(onChange, () => NOW);
    vi.advanceTimersByTime(untilMidnight(NOW) - 1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    off();
    vi.advanceTimersByTime(2 * 86_400_000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('counts to just after midnight on the browser’s clock', () => {
    const midnight = new Date(2026, 9, 11, 0, 0, 1).getTime();
    expect(untilMidnight(NOW)).toBe(midnight - NOW);
  });
});
