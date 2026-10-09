/**
 * Options page install id reset (sprint 0.10) on the real build in Chromium: the two-step reset changes both the
 * stored and the displayed id, from the mouse and from the keyboard alone, Cancel keeps it, an id changed elsewhere
 * is no longer shown, and the page logs no console errors. Split from options.spec.ts (file and function size
 * limits, TECH-C8).
 */
import type { Page } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { STORAGE_KEYS } from '../../src/config';
import {
  expectVisibleFocus,
  focusState,
  installedId,
  openOptions,
  storedInstallId,
  UUID_V4,
} from './support/options-page';
import { expect, test } from './support/test';

declare const chrome: WxtBrowser;

const RESET_DONE = 'Install id reset. The new id is shown above.';

/** The install id panel's status line: the Danger zone holds Delete all data's too (sprint_4 4.5). */
const installIdStatus = (page: Page) => page.getByRole('group', { name: 'Install id' }).getByRole('status');

test.describe('options page: the two-step reset from the keyboard', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the two-step reset works from the keyboard alone, focus visible throughout (${colorScheme})`, async ({
      attest,
    }) => {
      const before = await installedId(attest);
      const worker = await attest.serviceWorker();
      const { page, errors } = await openOptions(attest);
      await page.emulateMedia({ colorScheme });
      const start = page.getByRole('button', { name: 'Reset install id', exact: true });
      const confirm = page.getByRole('button', { name: 'Reset id', exact: true });
      const cancel = page.getByRole('button', { name: 'Cancel', exact: true });

      await start.focus();
      await expectVisibleFocus(page, await focusState(page));
      // Focus is read at once, without auto-waiting. The stricter same-task guarantee has its own test in
      // options.spec.ts.
      await page.keyboard.press('Enter');
      expect((await focusState(page)).label).toBe('Cancel');
      await expectVisibleFocus(page, await focusState(page));
      await page.keyboard.press('Enter');
      expect((await focusState(page)).label).toBe('Reset install id');
      expect(await storedInstallId(worker)).toBe(before);
      await page.keyboard.press('Enter');
      await page.keyboard.press('Shift+Tab');
      expect((await focusState(page)).label).toBe('Reset id');
      await expect(confirm).toBeFocused();
      await expect(cancel).toBeVisible();
      await expectVisibleFocus(page, await focusState(page));
      await page.keyboard.press('Enter');

      await expect(installIdStatus(page)).toHaveText(RESET_DONE);
      await expect(start).toBeFocused();
      const after = await storedInstallId(worker);
      expect(after).toMatch(UUID_V4);
      expect(after).not.toBe(before);
      await expect(page.locator('#install-id-value')).toHaveText(after);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('options page: the install id reset', () => {
  test('install id exists after install; Cancel keeps it; confirming resets stored and shown id', async ({
    attest,
  }) => {
    const before = await installedId(attest);
    const worker = await attest.serviceWorker();
    const { page, errors } = await openOptions(attest);
    const shown = page.locator('#install-id-value');
    const start = page.getByRole('button', { name: 'Reset install id', exact: true });
    await expect(shown).toHaveText(before);

    await start.click();
    await expect(page.getByRole('group', { name: /Replace the install id/ })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(start).toBeFocused();
    expect(await storedInstallId(worker)).toBe(before);
    await expect(shown).toHaveText(before);
    await expect(installIdStatus(page)).toHaveText('');

    await start.click();
    await page.getByRole('button', { name: 'Reset id', exact: true }).click();

    await expect(installIdStatus(page)).toHaveText(RESET_DONE);
    const after = await storedInstallId(worker);
    expect(after).toMatch(UUID_V4);
    expect(after).not.toBe(before);
    await expect(shown).toHaveText(after);

    await page.reload();
    await expect(shown).toHaveText(after);
    expect(await storedInstallId(worker)).toBe(after);
    expect(errors).toEqual([]);
  });

  test('a reset in one options tab updates the id shown in another', async ({ attest }) => {
    await installedId(attest);
    const first = await openOptions(attest);
    const second = await openOptions(attest);

    await first.page.getByRole('button', { name: 'Reset install id', exact: true }).click();
    await first.page.getByRole('button', { name: 'Reset id', exact: true }).click();
    await expect(installIdStatus(first.page)).toHaveText(RESET_DONE);

    const after = await first.page.locator('#install-id-value').innerText();
    await expect(second.page.locator('#install-id-value')).toHaveText(after);
    expect([...first.errors, ...second.errors]).toEqual([]);
  });
});

test.describe('options page: an install id changed elsewhere', () => {
  test('an id removed or corrupted elsewhere is no longer shown; Reset creates a new one', async ({
    attest,
  }) => {
    const before = await installedId(attest);
    const worker = await attest.serviceWorker();
    const { page, errors } = await openOptions(attest);
    const shown = page.locator('#install-id-value');

    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({ [key]: 'not-an-id' });
    }, STORAGE_KEYS.INSTALL_ID);

    await expect(page.getByText('No valid install id is stored.')).toBeVisible();
    await expect(shown).toHaveCount(0);
    await expect(page.getByText(before)).toHaveCount(0);

    await page.getByRole('button', { name: 'Reset install id', exact: true }).click();
    await page.getByRole('button', { name: 'Reset id', exact: true }).click();
    await expect(installIdStatus(page)).toHaveText(RESET_DONE);
    const after = await storedInstallId(worker);
    expect(after).toMatch(UUID_V4);
    await expect(shown).toHaveText(after);
    expect(errors).toEqual([]);
  });
});
