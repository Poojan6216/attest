import { expect, test } from './support/test';

test('the extension loads and a blank fixture page opens beside it', async ({ attest, fixtures }) => {
  const worker = await attest.serviceWorker();
  expect(worker.url()).toBe(`chrome-extension://${attest.extensionId}/background.js`);

  const page = await attest.context.newPage();
  await page.goto(fixtures.url('_harness/blank.html'));
  await expect(page).toHaveTitle('Attest harness: blank page');
});
