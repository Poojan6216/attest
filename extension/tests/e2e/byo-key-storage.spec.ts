/**
 * The person's own key is closed to content scripts (Sprint 5 close, security review SEC-6; src/background/byo.ts
 * `closeStorage`): on the built extension, with a key saved through the options page, Attest's own content script in a
 * Gmail tab cannot read `chrome.storage.local` at all, so neither the key nor its vendor, while an extension page can.
 * Chrome's documentation gives `setAccessLevel` for every storage area since Chrome 102, below the extension's minimum
 * of 120. The key is invented.
 */
import { expect, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { STORAGE_KEYS } from '../../src/config';
import { BYO_KEY_SEED, saveKey } from './support/byo-key';
import { contentScriptEvaluate } from './support/content-world';
import { withVendorSession } from './support/session';
import { openVendorPage, vendorFixture } from './support/vendor-pages';

declare const chrome: WxtBrowser;

/** What a content script gets when it reads the whole of `chrome.storage.local`: refused, or what it read. */
const READ_EVERYTHING = `(() => {
  try {
    return chrome.storage.local.get(null).then(
      (items) => 'read: ' + JSON.stringify(items),
      (error) => 'refused: ' + String(error && error.message),
    );
  } catch (error) {
    return 'refused: ' + String(error && error.message);
  }
})()`;

test('a content script cannot read the saved key; an extension page can read its vendor', async () => {
  test.setTimeout(2 * 60_000);
  await withVendorSession(async (session) => {
    await saveKey(session.extension);
    const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
    const tab = await openVendorPage(session.extension.context, session.routes, sent);
    // The content script is in the tab once its world exists.
    let evaluate: ((expression: string) => Promise<unknown>) | undefined;
    await expect
      .poll(async () => {
        evaluate = await contentScriptEvaluate(tab, session.extension.extensionId).catch(() => undefined);
        return evaluate !== undefined;
      })
      .toBe(true);
    const read = String(await evaluate?.(READ_EVERYTHING));
    expect(read).toMatch(/^refused: /u);
    expect(read).not.toContain(BYO_KEY_SEED.value);
    const vendor = await session.ledgerPage.evaluate(
      (key) => chrome.storage.local.get(key).then((items) => items[key]),
      STORAGE_KEYS.BYO_VENDOR,
    );
    expect(vendor).toBe('anthropic');
  });
});
