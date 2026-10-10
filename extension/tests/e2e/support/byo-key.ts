/**
 * The person's own model key in the mandatory secret-seed test (tests/e2e/no-leak.spec.ts; sprint_5 5.3 done-when:
 * "the key never appears in logs/export (secret-seed test includes a fake key)"). The session saves an invented key
 * through the options page as a person would, and turns their own key on. It must then be in exactly its own slot of
 * `chrome.storage.local` (STORAGE_KEYS.BYO_KEY, closed to content scripts), and in no channel otherwise: every channel
 * is searched for it with that one slot taken out. The negative control plants the key in another storage key and in
 * the console, so the slot taken out is that slot alone.
 */
import { expect, type Page, type Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { STORAGE_KEYS } from '../../../src/config';
import type { LaunchedExtension } from './extension';
import type { Seed } from './leaks';

declare const chrome: WxtBrowser;

/** An invented key in the shape of a vendor's (src/bus/page-commands.ts ByoKey). */
export const BYO_KEY_SEED: Seed = {
  id: 'byo_key',
  kind: 'api_key',
  value: 'sk-ant-noleakseed-Q7xV2mLp9RzT4kWb',
  canaries: ['noleakseed', 'Q7xV2mLp9RzT4kWb'],
};

/** Saves `key` in the options page's Model section, as a person would, and turns their own key on. */
export async function saveKey(extension: LaunchedExtension, key: string = BYO_KEY_SEED.value): Promise<void> {
  const options = await extension.openExtensionPage('options.html');
  const byo = options.getByRole('group', { name: 'Your own model key' });
  await byo.getByLabel('Your key').fill(key);
  await byo.getByRole('button', { name: 'Save key' }).click();
  await expect(byo.getByRole('status')).toContainText('Your Anthropic key is saved.');
  await byo.getByRole('button', { name: 'Turn on my own key' }).click();
  await expect(byo.getByRole('status')).toContainText('Your own key is on.');
  await options.close();
}

/** The chrome.storage channel (`{local, session, sync}` as the collector read it) without the key's own slot. */
export function withoutKeySlot(
  storage: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const local = storage.local;
  if (typeof local !== 'object' || local === null) return storage;
  const kept = Object.fromEntries(Object.entries(local).filter(([key]) => key !== STORAGE_KEYS.BYO_KEY));
  return { ...storage, local: kept };
}

/** The negative control's plants of the key: another key of chrome.storage.local, and the service worker's console. */
export async function plantKey(page: Page, worker: Worker): Promise<void> {
  await page.evaluate((key) => chrome.storage.local.set({ probeKey: key }), BYO_KEY_SEED.value);
  await worker.evaluate((key) => {
    console.info(`calling with ${key}`);
  }, BYO_KEY_SEED.value);
}
