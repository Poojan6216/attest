/**
 * Reading what the side panel would share (sprint_4 4.8), for the end-to-end tests: each receipt of the timeline opened
 * in turn, shared, and its text read as it would be copied (sprint_4 close: the receipt's share is a channel of the
 * secret-seed test; security review SEC-1, QA review GAP 9).
 */
import { expect } from '@playwright/test';

import type { LaunchedExtension } from './extension';

/** The share text of every receipt the side panel's timeline lists, in its order. */
export async function readReceiptShares(extension: LaunchedExtension): Promise<string[]> {
  const panel = await extension.openExtensionPage('sidepanel.html');
  const rows = panel.locator('li[data-receipt]');
  await rows.first().waitFor();
  const shares: string[] = [];
  for (let index = 0; index < (await rows.count()); index += 1) {
    await rows
      .nth(index)
      .getByRole('button', { name: /^Open details/u })
      .click();
    await panel.getByRole('button', { name: 'Share this receipt' }).click();
    const text = panel.getByLabel('What you would share');
    await expect(text).toContainText('# Attest receipt:');
    shares.push((await text.textContent()) ?? '');
    await panel.getByRole('button', { name: 'Return to the timeline' }).click();
    await rows.first().waitFor();
  }
  await panel.close();
  return shares;
}
