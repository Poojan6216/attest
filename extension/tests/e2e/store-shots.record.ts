/**
 * The store listing's five screenshots and its promo tile (sprint_7 7.4; `pnpm record-screenshots`, which runs this with
 * playwright.record.config.ts): Attest's own pages on the built extension, after the build_spec §2 demo's flow on saved
 * test pages with invented names. Each screenshot is 1280×800, the page centred above a one-line caption, as the demo's
 * frames are (./support/frames.ts); the promo tile is 440×280. Before each shot, the page's text is searched for every
 * seeded secret (./support/leaks.ts) and every email address in it must be at a reserved example domain, so no real
 * person's data reaches a picture. Written to ATTEST_STORE_SHOTS, as listed in launch/store-listing.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { DEMO_LOG } from './support/demo';
import { openDemoPages, writeAway } from './support/demo-flow';
import { makeDigestNow } from './support/digest';
import { compose, draw, type Frame, PANEL, shoot, SHOT } from './support/frames';
import { findLeaks, loadSeeds } from './support/leaks';
import { pasteActivity } from './support/paste';
import { type VendorSession, withVendorSession } from './support/session';
import { brokenSentList, requestUrl, waitForLedger } from './support/vendor-pages';

const SEEDS = loadSeeds();
/** An address at a domain reserved for examples (RFC 2606, RFC 6761): `example.com`, `.org`, `.net`, or `*.example`. */
const RESERVED = /@(?:[\w-]+\.)*(?:example\.(?:com|net|org)|[\w-]+\.example)$/iu;
const ICON = path.resolve(import.meta.dirname, '../../public/icon/128.png');

/** Throws unless `page`'s text holds no seeded secret and only invented addresses (header). */
async function onlyInvented(page: Page): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  expect(findLeaks(page.url(), text, SEEDS)).toEqual([]);
  const addresses = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu) ?? [];
  expect(addresses.filter((address) => !RESERVED.test(address))).toEqual([]);
}

async function popupShot(session: VendorSession): Promise<Buffer> {
  const popup = await session.extension.openExtensionPage('popup.html');
  await popup.setViewportSize(PANEL);
  const receipts = popup.locator('li[data-receipt]');
  for (const grade of ['Verified', 'Not found', 'Unasked']) {
    await expect(receipts.filter({ hasText: `Grade: ${grade}` })).toHaveCount(1);
  }
  await onlyInvented(popup);
  return shoot(popup, PANEL);
}

async function detailShot(session: VendorSession): Promise<Buffer> {
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  await panel.setViewportSize(PANEL);
  const unasked = panel.locator('li[data-receipt]').filter({ hasText: 'Grade: Unasked' });
  await unasked.getByRole('button', { name: /^Open details/u }).click();
  await expect(panel.getByRole('heading', { name: 'Receipt' })).toBeFocused();
  await expect(panel.getByRole('list', { name: 'Evidence' })).toContainText('Sent-folder row');
  await onlyInvented(panel);
  return shoot(panel, PANEL);
}

async function grantsShot(session: VendorSession): Promise<Buffer> {
  const options = await session.extension.openExtensionPage('options.html');
  await options.setViewportSize(SHOT);
  const muse = options.getByRole('region', { name: 'Muse' });
  await muse.getByLabel('May write to').fill('company.example');
  await muse.getByRole('button', { name: 'Save Muse’s grant' }).click();
  await expect(muse.getByRole('status')).toContainText('Saved.');
  await onlyInvented(options);
  return muse.screenshot({ type: 'png' });
}

async function degradedShot(session: VendorSession, gmail: Page): Promise<Buffer> {
  const broken = brokenSentList();
  session.routes.set(requestUrl(broken.url), broken.html);
  await gmail.goto(broken.url);
  await waitForLedger(session.ledgerPage, (ledger) =>
    ledger.tables.adapterHealth.some(
      ({ adapterId, status }) => adapterId === 'gmail.sent' && status === 'DEGRADED',
    ),
  );
  const popup = await session.extension.openExtensionPage('popup.html');
  await popup.setViewportSize(PANEL);
  await expect(popup.getByRole('alert').filter({ hasText: 'Degraded:' })).toBeVisible();
  await onlyInvented(popup);
  return shoot(popup, PANEL);
}

async function digestShot(session: VendorSession): Promise<Buffer> {
  await makeDigestNow(session.extension, session.ledgerPage);
  const digest = await session.extension.openExtensionPage('digest.html');
  await expect(digest.getByText('Likely agent').first()).toBeVisible();
  await onlyInvented(digest);
  return shoot(digest, SHOT);
}

/** The 440×280 promo tile: the icon, the name and the one line. */
function promoTile(session: VendorSession): Promise<Buffer> {
  const icon = readFileSync(ICON).toString('base64');
  return draw(
    session.extension.context,
    { width: 440, height: 280 },
    `<!doctype html><html><head><style>
    html, body { margin: 0; width: 440px; height: 280px; overflow: hidden; }
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
      background: #202124; color: #fff; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    img { width: 72px; height: 72px; }
    h1 { margin: 0; font-size: 40px; font-weight: 600; }
    p { margin: 0; font-size: 20px; color: #e8eaed; }
  </style></head><body><img src="data:image/png;base64,${icon}" alt=""><h1>Attest</h1>
  <p>Receipts for your AI agents</p></body></html>`,
  );
}

test('the store listing’s screenshots and promo tile', async () => {
  test.setTimeout(6 * 60_000);
  const out = process.env.ATTEST_STORE_SHOTS;
  if (out === undefined) throw new Error('ATTEST_STORE_SHOTS names no folder: run `pnpm record-screenshots`');
  mkdirSync(out, { recursive: true });
  await withVendorSession(async (session) => {
    const [gmail] = await openDemoPages(session);
    if (gmail === undefined) throw new Error('the demo pages did not open');
    await writeAway(session);
    const panel = await session.extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(panel, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
    // Taken in this order, the reader broken last so the others show it well; named in the listing's order.
    const receipts = await popupShot(session);
    const detail = await detailShot(session);
    const grants = await grantsShot(session);
    const digest = await digestShot(session);
    const degraded = await degradedShot(session, gmail);
    const shots: (readonly [string, Frame])[] = [
      [
        '1-receipts.png',
        {
          image: receipts,
          caption: 'Today’s receipts: what each agent said it did, against your own Gmail and Calendar tabs.',
        },
      ],
      [
        '2-receipt-detail.png',
        {
          image: detail,
          caption: 'Each receipt shows its evidence, and says “likely” when it cannot prove who acted.',
        },
      ],
      [
        '3-grants.png',
        {
          image: grants,
          caption: 'Grants say what each agent may do; a claim outside them is marked Over scope.',
        },
      ],
      [
        '4-degraded.png',
        {
          image: degraded,
          caption: 'When a page changes and a reader stops matching, Attest says so instead of going quiet.',
        },
      ],
      [
        '5-digest.png',
        { image: digest, caption: 'The weekly digest: what each agent claimed, and what Attest found.' },
      ],
    ];
    for (const [file, frame] of shots) {
      writeFileSync(path.join(out, file), await compose(session.extension.context, frame));
    }
    writeFileSync(path.join(out, 'promo-tile.png'), await promoTile(session));
  });
});
