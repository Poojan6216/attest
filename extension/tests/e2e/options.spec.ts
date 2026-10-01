/**
 * Options page shell (sprint 0.10) on the real build in Chromium:
 * opens from the extension menu, the privacy line comes first, every control is keyboard reachable with a
 * visible focus ring, dark and light mode both read, the install id exists after install and the
 * two-step reset changes both the stored and the displayed id, and the page logs no console errors.
 */
import type { Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { STORAGE_KEYS } from '../../src/config';
import type { LaunchedExtension } from './support/extension';
import { expect, test } from './support/test';

declare const chrome: WxtBrowser;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECTION_TITLES = ['Grants', 'Adapters', 'Privacy', 'Model', 'Export', 'Danger zone'];
const STUB_SECTION_IDS = ['grants', 'adapters', 'model', 'export'];
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
const RESET_DONE = 'Install id reset. The new id is shown above.';

type Rgba = readonly [number, number, number, number];

interface OpenedOptions {
  readonly page: Page;
  /** Console errors and uncaught exceptions seen on the page since before it loaded. */
  readonly errors: string[];
}

async function storedInstallId(worker: Worker): Promise<string> {
  const value = await worker.evaluate(
    async (key) => (await chrome.storage.local.get(key))[key],
    STORAGE_KEYS.INSTALL_ID,
  );
  return typeof value === 'string' ? value : '';
}

/** Waits for the install handler to create the id, so the page never races it. */
async function installedId(attest: LaunchedExtension): Promise<string> {
  const worker = await attest.serviceWorker();
  await expect.poll(() => storedInstallId(worker)).toMatch(UUID_V4);
  return storedInstallId(worker);
}

async function openOptions(attest: LaunchedExtension): Promise<OpenedOptions> {
  const page = await attest.context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  // The reset confirms inline; window.confirm/alert/prompt are not allowed on this page.
  page.on('dialog', (dialog) => {
    errors.push(`dialog: ${dialog.type()}`);
    void dialog.dismiss();
  });
  await page.goto(`chrome-extension://${attest.extensionId}/options.html`);
  await expect(page.locator('#install-id-value')).toHaveText(UUID_V4);
  return { page, errors };
}

/** Resolves CSS colours (Tailwind 4 computes to oklch) to sRGB + alpha by painting them on a canvas. */
async function toRgba(page: Page, colours: readonly string[]): Promise<Rgba[]> {
  return page.evaluate((list) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');
    return list.map((css): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a];
    });
  }, colours);
}

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Page background, a section's background and the h1 colour. */
async function pageColours(page: Page): Promise<{ background: Rgba; card: Rgba; text: Rgba }> {
  const css = await page.evaluate(() => {
    const heading = document.querySelector('h1');
    const card = document.getElementById('grants');
    if (!heading || !card) throw new Error('options page did not render');
    return [
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(card).backgroundColor,
      getComputedStyle(heading).color,
    ];
  });
  const [background, card, text] = await toRgba(page, css);
  if (!background || !card || !text) throw new Error('colour resolution failed');
  return { background, card, text };
}

interface FocusState {
  readonly marker: string | null;
  readonly label: string;
  readonly outlineStyle: string;
  readonly outlineWidth: number;
  readonly outlineColor: string;
  /** Background colours from the parent up to the root: the outline (offset outside the box) sits on them. */
  readonly backdrops: readonly string[];
}

async function focusState(page: Page): Promise<FocusState> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) {
      return {
        marker: null,
        label: 'body',
        outlineStyle: 'none',
        outlineWidth: 0,
        outlineColor: '',
        backdrops: [],
      };
    }
    const backdrops: string[] = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      backdrops.push(getComputedStyle(node).backgroundColor);
    }
    const style = getComputedStyle(element);
    return {
      marker: element.dataset.e2eTab ?? null,
      label: element.textContent.trim(),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      backdrops,
    };
  });
}

/** Visible focus: a drawn outline with at least 3:1 contrast against what it sits on (WCAG 1.4.11). */
async function expectVisibleFocus(page: Page, state: FocusState): Promise<void> {
  expect(state.outlineStyle, `outline style on "${state.label}"`).not.toBe('none');
  expect(state.outlineWidth, `outline width on "${state.label}"`).toBeGreaterThan(0);
  const [outline, ...backdrops] = await toRgba(page, [state.outlineColor, ...state.backdrops]);
  const backdrop = backdrops.find((colour) => colour[3] > 0);
  if (!outline || !backdrop) throw new Error(`no colours resolved for "${state.label}"`);
  expect(contrast(outline, backdrop), `outline contrast on "${state.label}"`).toBeGreaterThanOrEqual(3);
}

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
    expect(secondLine).toMatch(/^Attest reads only pages you have open\b.*sends nothing to any server\.$/);

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
      // Focus is read at once, without auto-waiting. The stricter same-task guarantee has its own test below.
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

      await expect(page.getByRole('status')).toHaveText(RESET_DONE);
      await expect(start).toBeFocused();
      const after = await storedInstallId(worker);
      expect(after).toMatch(UUID_V4);
      expect(after).not.toBe(before);
      await expect(page.locator('#install-id-value')).toHaveText(after);
      expect(errors).toEqual([]);
    });
  }

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
    await expect(page.getByRole('status')).toHaveText('');

    await start.click();
    await page.getByRole('button', { name: 'Reset id', exact: true }).click();

    await expect(page.getByRole('status')).toHaveText(RESET_DONE);
    const after = await storedInstallId(worker);
    expect(after).toMatch(UUID_V4);
    expect(after).not.toBe(before);
    await expect(shown).toHaveText(after);

    await page.reload();
    await expect(shown).toHaveText(after);
    expect(await storedInstallId(worker)).toBe(after);
    expect(errors).toEqual([]);
  });

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
    await expect(page.getByRole('status')).toHaveText(RESET_DONE);
    const after = await storedInstallId(worker);
    expect(after).toMatch(UUID_V4);
    await expect(shown).toHaveText(after);
    expect(errors).toEqual([]);
  });

  test('a reset in one options tab updates the id shown in another', async ({ attest }) => {
    await installedId(attest);
    const first = await openOptions(attest);
    const second = await openOptions(attest);

    await first.page.getByRole('button', { name: 'Reset install id', exact: true }).click();
    await first.page.getByRole('button', { name: 'Reset id', exact: true }).click();
    await expect(first.page.getByRole('status')).toHaveText(RESET_DONE);

    const after = await first.page.locator('#install-id-value').innerText();
    await expect(second.page.locator('#install-id-value')).toHaveText(after);
    expect([...first.errors, ...second.errors]).toEqual([]);
  });
});
