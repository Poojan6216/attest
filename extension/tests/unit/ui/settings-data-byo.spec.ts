/**
 * What the options page knows of the person's own model key (Sprint 5 QA review; src/ui/settings-data.ts
 * `loadByoVendor`; sprint_5 5.3; Hard Rules 2, 10). Before, it ran only end to end. The page learns whether a key is
 * saved, and for which vendor, by reading the vendor alone: it never asks storage for the key itself, so no page holds
 * the key in memory to lose. A vendor that is not one Attest calls, or no vendor, reads as none. Every value is
 * invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { STORAGE_KEYS } from '../../../src/config';
import { loadByoVendor } from '../../../src/ui/settings-data';

const KEY = 'sk-ant-qa-invented-page-0123456789';

beforeEach(() => {
  fakeBrowser.reset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadByoVendor', () => {
  it('is null with no key saved, and the vendor once one is', async () => {
    expect(await loadByoVendor()).toBeNull();
    await browser.storage.local.set({ [STORAGE_KEYS.BYO_KEY]: KEY, [STORAGE_KEYS.BYO_VENDOR]: 'openai' });
    expect(await loadByoVendor()).toBe('openai');
  });

  it('reads the vendor alone, never the key', async () => {
    await browser.storage.local.set({ [STORAGE_KEYS.BYO_KEY]: KEY, [STORAGE_KEYS.BYO_VENDOR]: 'anthropic' });
    const get = vi.spyOn(browser.storage.local, 'get');
    expect(await loadByoVendor()).toBe('anthropic');
    expect(get.mock.calls).toEqual([[STORAGE_KEYS.BYO_VENDOR]]);
    expect(JSON.stringify(await get.mock.results[0]?.value)).not.toContain(KEY);
  });

  it.each([['mistral'], [''], [42], [{ vendor: 'anthropic' }]])(
    'reads a stored vendor Attest does not call (%o) as none',
    async (stored) => {
      await browser.storage.local.set({ [STORAGE_KEYS.BYO_VENDOR]: stored });
      expect(await loadByoVendor()).toBeNull();
    },
  );
});
