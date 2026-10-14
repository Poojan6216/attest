/**
 * Helpers for the options page E2E tests (options.spec.ts, options-reset.spec.ts): open the page on the real build
 * with its console errors recorded, read the stored install id, and measure focus outlines and colours.
 */
import type { Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { STORAGE_KEYS } from '../../../src/config';
import { PRIVACY_UNKNOWN } from '../../../src/ui/privacy-text';
import type { LaunchedExtension } from './extension';
import { expect } from './test';

declare const chrome: WxtBrowser;

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Rgba = readonly [number, number, number, number];

interface OpenedOptions {
  readonly page: Page;
  /** Console errors and uncaught exceptions seen on the page since before it loaded. */
  readonly errors: string[];
}

export async function storedInstallId(worker: Worker): Promise<string> {
  const value = await worker.evaluate(
    async (key) => (await chrome.storage.local.get(key))[key],
    STORAGE_KEYS.INSTALL_ID,
  );
  return typeof value === 'string' ? value : '';
}

/** Waits for the install handler to create the id, so the page never races it. */
export async function installedId(attest: LaunchedExtension): Promise<string> {
  const worker = await attest.serviceWorker();
  await expect.poll(() => storedInstallId(worker)).toMatch(UUID_V4);
  return storedInstallId(worker);
}

export async function openOptions(attest: LaunchedExtension): Promise<OpenedOptions> {
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
  await expectSettled(page);
  return { page, errors };
}

/**
 * Waits for every read the page starts when it opens: the person's choices behind the privacy line, each section's
 * skeleton gone, the usage numbers read, and Chrome's answer on away detection. Each one changes the page when it
 * answers, so `openOptions` waits for all four: on a slow runner the install id can arrive first, and a test that read
 * the page then saw the line's wording for choices not yet known, or counted controls a section had still to add (CI
 * runs 38487321880 and 38498796045).
 */
export async function expectSettled(page: Page): Promise<void> {
  await expect(page.getByText(PRIVACY_UNKNOWN, { exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByText('Reading the numbers the next send would hold.')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'When you are away' }).getByRole('status')).not.toHaveText('');
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
export function luminance([r, g, b]: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Page background, a section's background and the h1 colour. */
export async function pageColours(page: Page): Promise<{ background: Rgba; card: Rgba; text: Rgba }> {
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

export async function focusState(page: Page): Promise<FocusState> {
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
export async function expectVisibleFocus(page: Page, state: FocusState): Promise<void> {
  expect(state.outlineStyle, `outline style on "${state.label}"`).not.toBe('none');
  expect(state.outlineWidth, `outline width on "${state.label}"`).toBeGreaterThan(0);
  const [outline, ...backdrops] = await toRgba(page, [state.outlineColor, ...state.backdrops]);
  const backdrop = backdrops.find((colour) => colour[3] > 0);
  if (!outline || !backdrop) throw new Error(`no colours resolved for "${state.label}"`);
  expect(contrast(outline, backdrop), `outline contrast on "${state.label}"`).toBeGreaterThanOrEqual(3);
}
