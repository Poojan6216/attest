/**
 * Grants on the built extension (sprint_4 4.4 done-when): a tighter grant saved in the options page (Muse may no
 * longer send email) makes the receipt of a new matching claim OVER_SCOPE (the claim's type is not allowed); an invalid
 * recipient is blocked with its message and saves nothing. No console error.
 */
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { DEMO_LOG, demoSentPage } from './support/demo';
import { pasteActivity } from './support/paste';
import { withVendorSession } from './support/session';
import { fixtureUrl, readLedger, requestUrl, vendorFixture, waitForLedger } from './support/vendor-pages';

test('a tighter grant saved in the options page makes a new matching claim OVER_SCOPE', async () => {
  test.setTimeout(3 * 60_000);
  await withVendorSession(async (session) => {
    const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
    session.routes.set(requestUrl(fixtureUrl(sent)), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
    const gmail = await session.extension.context.newPage();
    await gmail.goto(fixtureUrl(sent));
    await waitForLedger(session.ledgerPage, (ledger) =>
      ledger.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
    );

    const options = await session.extension.openExtensionPage('options.html');
    const errors: string[] = [];
    options.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    const muse = options.getByRole('region', { name: 'Muse' });
    await muse.getByLabel('May write to').fill('not a domain');
    await muse.getByRole('button', { name: 'Save Muse’s grant' }).click();
    await expect(muse.getByRole('alert').first()).toContainText('is not a domain');
    expect((await readLedger(session.ledgerPage)).tables.grants).toEqual([]);

    await muse.getByLabel('May write to').fill('');
    await muse.getByLabel('Email sent').uncheck();
    await muse.getByRole('button', { name: 'Save Muse’s grant' }).click();
    await expect(muse.getByRole('status')).toHaveText(
      'Saved. It applies to this agent’s open receipts now, and never changes a final one.',
    );
    await expect(muse).toContainText('Muse may: create calendar events');

    const panel = await session.extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
    const ledger = await readLedger(session.ledgerPage);
    const grant = ledger.tables.grants.find(({ agent }) => agent === 'muse');
    expect(grant?.allowedTypes).not.toContain('email.sent');
    const claim = ledger.tables.claims.find(({ type }) => type === 'email.sent');
    const receipt = ledger.tables.receipts.find(({ claimId }) => claimId === claim?.id);
    expect(receipt?.grade).toBe('OVER_SCOPE');
    expect(receipt?.reasons.map(({ code }) => code)).toContain('scope.type_not_allowed');
    await expect(panel.locator('li[data-receipt]').filter({ hasText: 'Email sent' })).toContainText(
      'Grade: Over scope',
    );
    expect(errors).toEqual([]);
  });
});
