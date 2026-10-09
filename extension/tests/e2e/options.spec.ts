/**
 * Options page shell (sprint 0.10) on the real build in Chromium:
 * opens from the extension menu, the privacy line comes first, every control is keyboard reachable with a
 * visible focus ring, a reset moves focus in the same task as it renders, dark and light mode both read, and the
 * page logs no console errors. The install id and its two-step reset are in options-reset.spec.ts.
 */
import type { Page } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import {
  contrast,
  expectVisibleFocus,
  focusState,
  installedId,
  luminance,
  openOptions,
  pageColours,
} from './support/options-page';
import { expect, test } from './support/test';

declare const chrome: WxtBrowser;

const SECTION_TITLES = ['Grants', 'Adapters', 'Privacy', 'Model', 'Export', 'Danger zone'];
// Grants are editable since sprint_4 4.4 (tests/e2e/grants.spec.ts).
const STUB_SECTION_IDS = ['model'];
/**
 * Every tab stop: each enabled control, and of a radio group only its checked radio (the arrow keys move within the
 * group, which the retention test below walks). A disabled control is no tab stop: the telemetry choice until Sprint 5,
 * and Save retention until another window is chosen (sprint_4 4.5).
 */
const INTERACTIVE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="radio"])',
  'input[type="radio"]:checked',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

test.describe('options page', () => {
  test('opens from the extension menu', async ({ attest }) => {
    const worker = await attest.serviceWorker();
    const optionsUrl = `chrome-extension://${attest.extensionId}/options.html`;
    const optionsTab = (): Page | undefined => attest.context.pages().find((p) => p.url() === optionsUrl);
    expect(optionsTab()).toBeUndefined();

    // The menu's "Options" item calls this. Chrome may open a new tab or reuse the blank one.
    await worker.evaluate(() => chrome.runtime.openOptionsPage());

    await expect.poll(() => optionsTab()?.url()).toBe(optionsUrl);
    const page = optionsTab();
    if (!page) throw new Error('options tab vanished');
    await expect(page).toHaveTitle('Attest settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Attest settings');
  });

  test('privacy line first, one h1, one h2 per section in order, stubs without controls', async ({
    attest,
  }) => {
    await installedId(attest);
    const { page, errors } = await openOptions(attest);

    const mainText = await page.getByRole('main').innerText();
    const [firstLine, secondLine] = mainText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    expect(firstLine).toBe('Nothing leaves your browser.');
    // The statement, then its link to the privacy architecture (ux_engineer rule 8; sprint_4 4.5).
    expect(secondLine).toMatch(
      /^Attest reads only pages you have open\b.*sends nothing to any server\. Read how\b/,
    );

    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main h2')).toHaveText(SECTION_TITLES);
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link')).toHaveText(
      SECTION_TITLES,
    );
    for (const title of SECTION_TITLES) {
      await expect(page.getByRole('region', { name: title, exact: true })).toBeVisible();
    }
    for (const id of STUB_SECTION_IDS) {
      const section = page.locator(`#${id}`);
      await expect(section).toContainText('Available in a later version.');
      await expect(section.locator('a, button, input, select, textarea')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('options page: keyboard', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`Tab reaches every interactive element, each with a visible focus outline (${colorScheme})`, async ({
      attest,
    }) => {
      await installedId(attest);
      const { page, errors } = await openOptions(attest);
      await page.emulateMedia({ colorScheme });

      const labels = await page.evaluate((selector) => {
        const elements = [...document.querySelectorAll<HTMLElement>(selector)];
        elements.forEach((element, index) => {
          element.dataset.e2eTab = String(index);
        });
        return elements.map((element) => element.textContent.trim());
      }, INTERACTIVE);
      expect(labels).toContain('Reset install id');
      expect(labels).toEqual(expect.arrayContaining(SECTION_TITLES));

      const reached = new Set<string>();
      for (let press = 0; press < labels.length + 2; press += 1) {
        await page.keyboard.press('Tab');
        const state = await focusState(page);
        if (state.marker === null) continue;
        reached.add(state.marker);
        await expectVisibleFocus(page, state);
      }
      expect([...reached].sort()).toEqual(labels.map((_, index) => String(index)).sort());
      expect(errors).toEqual([]);
    });
  }
});

test.describe('options page: the retention choice from the keyboard (sprint_4 4.5)', () => {
  test('the arrows move between the windows, and Tab then reaches Save retention', async ({ attest }) => {
    await installedId(attest);
    const { page, errors } = await openOptions(attest);
    const ninety = page.getByRole('radio', { name: '90 days (the default)' });
    await expect(ninety).toBeChecked();
    await ninety.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: '180 days' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '180 days' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save retention' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#privacy').getByRole('status').first()).toHaveText(
      'Saved. Attest keeps 180 days of history.',
    );
    expect(errors).toEqual([]);
  });
});

test.describe('options page: focus timing and colour schemes', () => {
  test('reset focus moves in the same task as the render, before any frame or timer', async ({ attest }) => {
    await installedId(attest);
    const { page, errors } = await openOptions(attest);

    // Activates a button, then reads the focused element after only the microtasks that follow. Preact
    // renders and runs layout effects in a microtask; no frame or timer has run yet. A focus move deferred
    // past this point (a plain effect runs after paint) lets a fast keyboard user's next key land on
    // <body>, and Tab then restarts from the top of the page.
    const focusRightAfterActivating = (label: string): Promise<string> =>
      page.evaluate(async (text) => {
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
        if (!button) throw new Error(`no button "${text}"`);
        button.click();
        await Promise.resolve();
        await Promise.resolve();
        const active = document.activeElement;
        return active instanceof HTMLElement && active !== document.body ? active.textContent.trim() : 'body';
      }, label);

    expect(await focusRightAfterActivating('Reset install id')).toBe('Cancel');
    expect(await focusRightAfterActivating('Cancel')).toBe('Reset install id');
    expect(errors).toEqual([]);
  });

  test('dark mode: dark background, light text; light mode: the opposite', async ({ attest }) => {
    await installedId(attest);
    const { page, errors } = await openOptions(attest);

    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await pageColours(page);
    expect(luminance(dark.background)).toBeLessThan(0.05);
    expect(luminance(dark.card)).toBeLessThan(0.05);
    expect(luminance(dark.text)).toBeGreaterThan(0.8);
    expect(contrast(dark.text, dark.card)).toBeGreaterThanOrEqual(7);

    await page.emulateMedia({ colorScheme: 'light' });
    const light = await pageColours(page);
    expect(luminance(light.background)).toBeGreaterThan(0.85);
    expect(luminance(light.card)).toBeGreaterThan(0.85);
    expect(luminance(light.text)).toBeLessThan(0.05);
    expect(contrast(light.text, light.card)).toBeGreaterThanOrEqual(7);
    expect(errors).toEqual([]);
  });
});
