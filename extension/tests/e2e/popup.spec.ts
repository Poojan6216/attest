/**
 * The popup on the built extension (sprint_4 4.2 done-when):
 *  - a fresh install says in words that there are no receipts today, and that no source was checked yet, never a blank;
 *  - the §2 demo with Calendar never opened (golden 14, docs/grading.md §16.14): the header says Calendar was not
 *    checked, and the calendar claim's receipt shows Unverifiable with its reason, beside the verified email;
 *  - over a ledger of 5,000 receipts, axe-core finds no serious or critical violation on the full popup in either
 *    theme (its paint is timed alone, in ./popup.paint.spec.ts).
 * No console error on any of them.
 */
import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { POPUP_RECEIPT_LIMIT } from '../../src/config';
import { DEMO_LOG, demoSentPage } from './support/demo';
import type { LaunchedExtension } from './support/extension';
import { pasteActivity } from './support/paste';
import { seedReceipts } from './support/popup-paint';
import { withVendorSession } from './support/session';
import { expect, test } from './support/test';
import { fixtureUrl, requestUrl, vendorFixture, waitForLedger } from './support/vendor-pages';

interface Opened {
  readonly page: Page;
  readonly errors: string[];
}

async function openPopup(extension: LaunchedExtension): Promise<Opened> {
  const page = await extension.context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(`chrome-extension://${extension.extensionId}/popup.html`);
  return { page, errors };
}

test.describe('the popup (sprint_4 4.2)', () => {
  test('a fresh install says there are no receipts today and that nothing was checked yet', async ({
    attest,
  }) => {
    const { page, errors } = await openPopup(attest);
    await expect(page.getByRole('status').filter({ hasText: 'No receipts today' })).toBeVisible();
    const header = page.getByRole('region', { name: 'What Attest has checked' });
    await expect(header.getByRole('listitem')).toHaveText([
      'Gmail Sent not checked yet',
      'Gmail receipts not checked yet',
      'Calendar not checked yet',
    ]);
    await expect(page.getByRole('button', { name: 'Open timeline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('with Calendar never opened, the header says so and the calendar claim is Unverifiable with its reason', async () => {
    test.setTimeout(3 * 60_000);
    await withVendorSession(async (session) => {
      const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
      session.routes.set(requestUrl(fixtureUrl(sent)), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
      const gmail = await session.extension.context.newPage();
      await gmail.goto(fixtureUrl(sent));
      await waitForLedger(session.ledgerPage, (ledger) =>
        ledger.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
      );
      const panel = await session.extension.openExtensionPage('sidepanel.html');
      expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
      const { page, errors } = await openPopup(session.extension);
      const header = page.getByRole('region', { name: 'What Attest has checked' });
      await expect(header).toContainText('Calendar not checked yet');
      await expect(header).toContainText(/Gmail Sent checked \d\d:\d\d/u);
      await expect(header).toContainText(/Muse activity added \d\d:\d\d/u);
      const calendar = page.locator('li[data-receipt]').filter({ hasText: 'Event created' });
      await expect(calendar).toContainText('Grade: Unverifiable');
      await expect(calendar).toContainText(
        "Attest did not see Google Calendar during this claim's time window.",
      );
      const email = page.locator('li[data-receipt]').filter({ hasText: 'Email sent' });
      await expect(email).toContainText('Grade: Verified');
      expect(errors).toEqual([]);
    });
  });
});

test.describe('the popup at 5,000 receipts (sprint_4 4.2)', () => {
  test('axe-core finds no serious or critical violation on a full popup, in the light or the dark theme', async ({
    attest,
  }) => {
    await seedReceipts(attest);
    for (const colorScheme of ['light', 'dark'] as const) {
      const page = await attest.context.newPage();
      await page.emulateMedia({ colorScheme });
      await page.goto(`chrome-extension://${attest.extensionId}/popup.html`);
      await page
        .locator('li[data-receipt]')
        .nth(POPUP_RECEIPT_LIMIT - 1)
        .waitFor();
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
      expect(
        serious.map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`),
      ).toEqual([]);
      await page.close();
    }
  });
});
