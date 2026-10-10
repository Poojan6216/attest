/**
 * The accessibility and copy pass on the built extension (sprint_4 4.10 done-when: "axe-core zero serious/critical
 * across all four surfaces"; with it, the task's full keyboard walk, screen-reader labels and reduced motion). After the
 * build_spec §2 demo and a weekly digest, in the light theme and in the dark one, with reduced motion asked for: the
 * popup; the side panel's timeline, and the detail of the UNASKED receipt with its share open; the options page; and
 * the digest page with its share open. On each: no serious or critical axe-core violation; copy with no exclamation
 * mark and no code, every grade chip one of the six grade names, every UNASKED row saying "Likely agent"; nothing
 * animating; no console error. Tab reaches every control of the popup, the side panel and the digest, each with a
 * visible focus outline (the options page has its own walk, tests/e2e/options.spec.ts). On the components page, the
 * loading skeleton pulses, and stops when reduced motion is asked for.
 */
import { expect, type Page, test } from '@playwright/test';

import { copyReport, runningAnimations, seriousViolations, tabWalk } from './support/a11y';
import { DEMO_LOG } from './support/demo';
import { openDemoPages, writeAway } from './support/demo-flow';
import { makeDigestNow } from './support/digest';
import { pasteActivity } from './support/paste';
import { type VendorSession, withVendorSession } from './support/session';
import { launchExtension } from './support/extension';

type Theme = 'light' | 'dark';

interface Surface {
  readonly name: string;
  readonly path: string;
  /** Brings the page, loaded, to the state checked. */
  readonly ready: (page: Page) => Promise<void>;
  /** Whether Tab is walked here. */
  readonly walk: boolean;
  /** The fewest UNASKED rows it shows: the demo's one wherever receipts are listed. */
  readonly unaskedRows: number;
}

const firstRow = async (page: Page): Promise<void> => {
  await page.locator('li[data-receipt]').first().waitFor();
};

/** The side panel's detail of the UNASKED receipt, its share open with the image drawn. */
async function unaskedDetail(page: Page): Promise<void> {
  await firstRow(page);
  await page
    .locator('li[data-receipt]')
    .filter({ hasText: 'Likely agent' })
    .getByRole('button', { name: /^Open details/u })
    .click();
  await page.getByRole('button', { name: 'Share this receipt' }).click();
  await expect(page.getByRole('img', { name: 'This receipt as an image' })).toBeVisible();
}

/** The digest of the week, its share open with the image drawn. */
async function digestShared(page: Page): Promise<void> {
  await firstRow(page);
  await page.getByRole('button', { name: 'Share this week' }).click();
  await expect(page.getByRole('img', { name: 'This week as an image' })).toBeVisible();
}

const SURFACES: readonly Surface[] = [
  { name: 'popup', path: 'popup.html', ready: firstRow, walk: true, unaskedRows: 1 },
  { name: 'side panel timeline', path: 'sidepanel.html', ready: firstRow, walk: true, unaskedRows: 1 },
  { name: 'side panel detail', path: 'sidepanel.html', ready: unaskedDetail, walk: true, unaskedRows: 1 },
  {
    name: 'options',
    path: 'options.html',
    ready: async (page) => {
      await page.getByRole('button', { name: 'Turn on checking Gmail' }).waitFor();
      await page.getByRole('button', { name: /^Save Muse’s grant$/u }).waitFor();
    },
    walk: false,
    unaskedRows: 0,
  },
  { name: 'digest', path: 'digest.html', ready: digestShared, walk: true, unaskedRows: 1 },
];

/** The §2 demo's receipts, VERIFIED, NOT_FOUND and UNASKED, and the digest of this week, in `session`'s ledger. */
async function demoWithDigest(session: VendorSession): Promise<void> {
  await openDemoPages(session);
  await writeAway(session);
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
  await panel.close();
  await makeDigestNow(session.extension, session.ledgerPage);
}

/** Opens `surface` in `theme` with reduced motion asked for; resolves the page and its console errors from the start. */
async function openSurface(
  session: VendorSession,
  surface: Surface,
  theme: Theme,
): Promise<{ page: Page; errors: string[] }> {
  const page = await session.extension.context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto(`chrome-extension://${session.extension.extensionId}/${surface.path}`);
  await surface.ready(page);
  return { page, errors };
}

for (const theme of ['light', 'dark'] as const) {
  test(`every surface passes axe, the copy rules, the keyboard and reduced motion (${theme})`, async () => {
    test.setTimeout(6 * 60_000);
    await withVendorSession(async (session) => {
      await demoWithDigest(session);
      for (const surface of SURFACES) {
        const { page, errors } = await openSurface(session, surface, theme);
        expect(await seriousViolations(page), surface.name).toEqual([]);
        const copy = await copyReport(page);
        expect(copy.faults, surface.name).toEqual([]);
        expect(copy.unaskedRows, surface.name).toBeGreaterThanOrEqual(surface.unaskedRows);
        if (surface.unaskedRows > 0) expect(copy.chips, surface.name).toBeGreaterThan(0);
        expect(await runningAnimations(page), surface.name).toEqual([]);
        if (surface.walk) {
          const walk = await tabWalk(page);
          expect(walk.controls, surface.name).toBeGreaterThan(0);
          expect(walk.missed, surface.name).toEqual([]);
        }
        expect(errors, surface.name).toEqual([]);
        await page.close();
      }
    });
  });
}

test('the loading skeleton pulses, and stops when reduced motion is asked for', async () => {
  const attest = await launchExtension();
  try {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const page = await attest.context.newPage();
      await page.emulateMedia({ reducedMotion });
      await page.goto(`chrome-extension://${attest.extensionId}/dev.html`);
      await page.getByRole('status').filter({ hasText: "Loading today's receipts" }).waitFor();
      const pulsing = (await runningAnimations(page)).filter((name) => name === 'pulse');
      if (reducedMotion === 'reduce') expect(pulsing).toEqual([]);
      else expect(pulsing.length).toBeGreaterThan(0);
      await page.close();
    }
  } finally {
    await attest.close();
  }
});
