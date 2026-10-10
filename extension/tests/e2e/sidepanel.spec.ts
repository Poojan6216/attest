/**
 * The side panel's timeline and a person's mark on a receipt, on the built extension (sprint_4 4.3 done-when):
 * the §2 demo's log pasted with Gmail open shows its receipts in the timeline; a receipt's detail shows the fields that
 * fed its score; a mark (Not found, with a reason) round-trips through the state machine: the receipt is
 * USER_OVERRIDDEN with its computed grade kept, and `pnpm attest replay` reproduces every receipt (the mark set aside,
 * never a grade change); undoing the mark returns it to FINAL, the mark kept in `reverted`, and replay still
 * reproduces every receipt. axe-core finds no serious or critical violation on the timeline or the detail. No console
 * error.
 */
import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import { DEMO_LOG, demoSentPage } from './support/demo';
import { pasteActivity } from './support/paste';
import { replayExport } from './support/replay';
import { type VendorSession, withVendorSession } from './support/session';
import { fixtureUrl, readLedger, requestUrl, vendorFixture, waitForLedger } from './support/vendor-pages';

const REASON = 'I sent it from my phone';

/** Opens the demo's Gmail Sent head, waits for its pass, and pastes Muse's log in a new side panel. */
async function pastedDemo(session: VendorSession): Promise<{ panel: Page; errors: string[] }> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  session.routes.set(requestUrl(fixtureUrl(sent)), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
  const gmail = await session.extension.context.newPage();
  await gmail.goto(fixtureUrl(sent));
  await waitForLedger(session.ledgerPage, (ledger) =>
    ledger.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
  );
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  const errors: string[] = [];
  panel.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  panel.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
  return { panel, errors };
}

async function seriousViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`);
}

/** The email claim's receipt, from the exported ledger. */
async function emailReceipt(session: VendorSession) {
  const ledger = await readLedger(session.ledgerPage);
  const claim = ledger.tables.claims.find(({ type }) => type === 'email.sent');
  const receipt = ledger.tables.receipts.find(({ claimId }) => claimId === claim?.id);
  if (receipt === undefined) throw new Error('no email receipt');
  return { ledger, receipt };
}

test('the timeline lists the pasted receipts, and a mark on one round-trips through replay as an override', async () => {
  test.setTimeout(3 * 60_000);
  await withVendorSession(async (session) => {
    const { panel, errors } = await pastedDemo(session);
    const email = panel.locator('li[data-receipt]').filter({ hasText: 'Email sent' });
    await expect(email).toContainText('Grade: Verified');
    await expect(panel.locator('li[data-receipt]').filter({ hasText: 'Event created' })).toContainText(
      'Grade: Unverifiable',
    );
    expect(await seriousViolations(panel)).toEqual([]);

    await email.getByRole('button', { name: /^Open details/u }).click();
    await expect(panel.getByRole('heading', { name: 'Receipt' })).toBeFocused();
    await expect(panel.getByRole('list', { name: 'Evidence' })).toContainText('Sent-folder row');
    await expect(panel.locator('dt').filter({ hasText: /^Rule$/u })).toBeVisible();
    await expect(panel.getByText('Read by')).toBeVisible();
    expect(await seriousViolations(panel)).toEqual([]);

    await panel.getByLabel('Not found: it did not happen').check();
    await panel.getByLabel('Why').fill(REASON);
    await panel.getByRole('button', { name: 'Save my mark' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    await expect(panel.getByText(`You marked it Not found: “${REASON}”.`).first()).toBeVisible();

    const overridden = await emailReceipt(session);
    expect(overridden.receipt).toMatchObject({
      state: 'USER_OVERRIDDEN',
      grade: 'VERIFIED',
      override: { grade: 'NOT_FOUND', reason: REASON, previousState: 'FINAL' },
    });
    const replayed = replayExport(overridden.ledger);
    expect(replayed).toMatch(/^ {2}mismatched {2}0$/mu);
    expect(replayed).toMatch(
      new RegExp(`^ {2}reproduced {2}${String(overridden.ledger.tables.receipts.length)}$`, 'mu'),
    );

    await panel.getByRole('button', { name: 'Undo my mark' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'Undone.' })).toBeVisible();
    const reverted = await emailReceipt(session);
    expect(reverted.receipt).toMatchObject({ state: 'FINAL', grade: 'VERIFIED' });
    expect(reverted.receipt.reverted).toHaveLength(1);
    expect(replayExport(reverted.ledger)).toMatch(/^ {2}mismatched {2}0$/mu);
    expect(errors).toEqual([]);
  });
});
