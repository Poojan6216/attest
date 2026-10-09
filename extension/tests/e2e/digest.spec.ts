/**
 * The weekly digest on the built extension (sprint_4 4.7 done-when). After the build_spec §2 demo, the digest alarm
 * fires with the service worker's clock advanced to the next Monday, and the digest of the week is made and kept; the
 * digest page renders its stored counts (Muse: Verified, Not found and Unasked, one each; 1 of 2 checked claims
 * verified), the receipts to look at with "Likely agent" on the UNASKED one, and a share that holds a counterparty by
 * domain only: no address anywhere. No console error.
 */
import { expect, test } from '@playwright/test';

import { DEMO_LOG } from './support/demo';
import { makeDigestNow, readShare } from './support/digest';
import { openDemoPages, writeAway } from './support/demo-flow';
import { pasteActivity } from './support/paste';
import { withVendorSession } from './support/session';

test('the digest alarm makes the week’s digest, which renders its counts and shares by domain only', async () => {
  test.setTimeout(4 * 60_000);
  await withVendorSession(async (session) => {
    await openDemoPages(session);
    await writeAway(session);
    const panel = await session.extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
    const ledger = await makeDigestNow(session.extension, session.ledgerPage);
    const [digest] = ledger.tables.digests;
    expect(
      digest?.agents.map(({ agent, grades, checked, verified }) => ({ agent, grades, checked, verified })),
    ).toEqual([
      {
        agent: 'muse',
        grades: { VERIFIED: 1, PARTIAL: 0, NOT_FOUND: 1, UNASKED: 1, OVER_SCOPE: 0, UNVERIFIABLE: 0 },
        checked: 2,
        verified: 1,
      },
    ]);

    const { page, share } = await readShare(session.extension);
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const muse = page.getByRole('listitem').filter({ hasText: 'checked claims verified' });
    await expect(muse).toContainText('1 of 2 checked claims verified.');
    await expect(page.getByRole('region', { name: 'To look at' })).toContainText('Likely agent');
    expect(share).toContain('Unasked: likely Muse');
    expect(share).toContain('supplier\\.example');
    expect(share).not.toMatch(/@/u);
    expect(share).not.toContain('Approved, please proceed');
    expect(errors).toEqual([]);
  });
});
