/**
 * The launch's pictures, made once for both their recorders and their test (Sprint 7 close: security review SEC-6, tech
 * review TECH-5 and TECH-7, QA review QA-9 and QA-16, privacy review gap 16). `demoFrames` is the build_spec §2 demo as
 * six captioned frames (../demo.record.ts writes them for launch/demo.gif); `storeShots` the listing's five screenshots
 * and its promo tile (../store-shots.record.ts writes them); ../launch-shots.spec.ts runs both in `pnpm e2e` and writes
 * nothing. Every page is checked by `onlyInvented` right before its picture is taken, the vendor test pages among them:
 * its text, every form field's value and every alt, title, label and placeholder hold no seeded secret
 * (./leaks.ts) and only addresses at domains reserved for examples (./invented.ts). A picture itself is not read; what
 * drew it is.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type BrowserContext, expect, type Page } from '@playwright/test';

import { DEMO_LOG } from './demo';
import { openDemoPages, writeAway } from './demo-flow';
import { makeDigestNow } from './digest';
import { draw, type Frame, PANEL, shoot, SHOT } from './frames';
import { realAddresses } from './invented';
import { findLeaks, loadSeeds } from './leaks';
import { importActivity, previewActivity } from './paste';
import type { VendorSession } from './session';
import { brokenSentList, requestUrl, waitForLedger } from './vendor-pages';

const SEEDS = loadSeeds();
const ICON = path.resolve(import.meta.dirname, '../../../public/icon/128.png');

/** The store's screenshots in the listing's order, each with its file name (launch/store-listing.md). */
export type StoreShot = readonly [string, Frame];

/** Throws unless what `page` draws holds no seeded secret and only invented addresses (header). */
export async function onlyInvented(page: Page): Promise<void> {
  const drawn = await page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const field of document.querySelectorAll<HTMLInputElement>('input, textarea, select'))
      parts.push(field.value);
    for (const element of document.querySelectorAll('[alt], [title], [aria-label], [placeholder]')) {
      for (const name of ['alt', 'title', 'aria-label', 'placeholder'])
        parts.push(element.getAttribute(name) ?? '');
    }
    return parts.join('\n');
  });
  expect(findLeaks(page.url(), drawn, SEEDS), page.url()).toEqual([]);
  expect(realAddresses(drawn), page.url()).toEqual([]);
}

/** `page` shot at `size`, once checked (header). */
async function checkedShot(
  page: Page,
  size: { readonly width: number; readonly height: number },
): Promise<Buffer> {
  await page.setViewportSize(size);
  await onlyInvented(page);
  return shoot(page, size);
}

/** The popup once it shows the demo's three receipts. */
async function receiptsShot(session: VendorSession): Promise<Buffer> {
  const popup = await session.extension.openExtensionPage('popup.html');
  await popup.setViewportSize(PANEL);
  const receipts = popup.locator('li[data-receipt]');
  for (const grade of ['Verified', 'Not found', 'Unasked']) {
    await expect(receipts.filter({ hasText: `Grade: ${grade}` })).toHaveCount(1);
  }
  return checkedShot(popup, PANEL);
}

/** The week's digest page, once the digest alarm has made it. */
async function digestShot(session: VendorSession): Promise<Buffer> {
  await makeDigestNow(session.extension, session.ledgerPage);
  const digest = await session.extension.openExtensionPage('digest.html');
  await expect(digest.getByText('Likely agent').first()).toBeVisible();
  return checkedShot(digest, SHOT);
}

/** The side panel with Muse's log pasted and previewed, shot before the import, which this then makes. */
async function pastedShot(session: VendorSession): Promise<Buffer> {
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  await panel.setViewportSize(PANEL);
  const importButton = await previewActivity(panel, 'Muse', DEMO_LOG);
  await expect(importButton).toHaveText('Import 2 claims');
  const shot = await checkedShot(panel, PANEL);
  expect(await importActivity(panel, importButton)).toBe('Imported 2 claims.');
  return shot;
}

/**
 * The saved Calendar page carries Calendar's structure but none of Google's styles, so its week would stack day under
 * day: these rules, for the frame only and after Attest has read the page, lay the seven days side by side.
 */
const WEEK_LAYOUT = `
  [role="main"] { padding: 16px; font-family: Arial, sans-serif; }
  [role="main"] [role="row"] { display: flex; }
  [role="main"] [role="columnheader"], [role="main"] [role="gridcell"] {
    flex: 1; min-height: 56px; padding: 8px; border: 1px solid #dadce0; }
  [role="main"] h2 { margin: 0; font-size: 18px; }
  [role="main"] [role="gridcell"] { min-height: 360px; }
  [role="main"] [aria-hidden="true"]:first-child { display: none; }`;

/** The demo's Calendar week, its seven days side by side (WEEK_LAYOUT), none holding an event. */
async function weekShot(calendar: Page): Promise<Buffer> {
  await calendar.setViewportSize(SHOT);
  await calendar.addStyleTag({ content: WEEK_LAYOUT });
  await expect(calendar.locator('[data-eventid]')).toHaveCount(0);
  await onlyInvented(calendar);
  return calendar.locator('[role="main"]').screenshot({ type: 'png' });
}

/** The build_spec §2 demo's six frames (header), every page checked before its picture. */
export async function demoFrames(session: VendorSession): Promise<Frame[]> {
  const [gmail, calendar] = await openDemoPages(session);
  if (gmail === undefined || calendar === undefined) throw new Error('the demo pages did not open');
  await writeAway(session);
  const pasted = await pastedShot(session);
  const graded = await receiptsShot(session);
  const week = await digestShot(session);
  return [
    {
      words: '“Email Priya the Q3 deck. Put a review on the calendar.”',
      caption: 'You ask Muse, your AI agent, to send an email and to add a calendar event.',
    },
    { image: pasted, caption: "Muse says it did both. You paste its activity log into Attest's side panel." },
    {
      image: await checkedShot(gmail, SHOT),
      caption:
        'You open your Gmail Sent folder, here a saved test page. Attest reads it, and changes nothing.',
    },
    {
      image: await weekShot(calendar),
      caption: 'You open Calendar, also a saved test page. No “Q3 review” in the week.',
    },
    {
      image: graded,
      caption:
        'Receipts: the email Verified, the event Not found, and a send to a vendor nobody asked for: Unasked, likely agent.',
    },
    { image: week, caption: "Each week's digest sums up what every agent claimed, and what Attest found." },
  ];
}

/** The side panel's Unasked receipt, opened to its evidence. */
async function detailShot(session: VendorSession): Promise<Buffer> {
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  await panel.setViewportSize(PANEL);
  const unasked = panel.locator('li[data-receipt]').filter({ hasText: 'Grade: Unasked' });
  await unasked.getByRole('button', { name: /^Open details/u }).click();
  await expect(panel.getByRole('heading', { name: 'Receipt' })).toBeFocused();
  await expect(panel.getByRole('list', { name: 'Evidence' })).toContainText('Sent email');
  return checkedShot(panel, PANEL);
}

/** Muse's grant, saved with an invented domain it may write to. */
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

/** The popup once the Gmail reader is Degraded on a Sent list it cannot match. */
async function degradedShot(session: VendorSession, gmail: Page): Promise<Buffer> {
  const broken = brokenSentList();
  session.routes.set(requestUrl(broken.url), broken.html);
  await gmail.goto(broken.url);
  await waitForLedger(session.ledgerPage, (ledger) =>
    ledger.tables.adapterHealth.some(
      ({ adapterId, status }) => adapterId === 'gmail.sent' && status === 'DEGRADED',
    ),
  );
  // The broken list holds seeded secrets, unread; it is in no picture, so the popup's check is the one that counts.
  const popup = await session.extension.openExtensionPage('popup.html');
  await popup.setViewportSize(PANEL);
  await expect(popup.getByRole('alert').filter({ hasText: 'Degraded:' })).toBeVisible();
  return checkedShot(popup, PANEL);
}

/** The store listing's five screenshots, in its order (header), every page checked before its picture. */
export async function storeShots(session: VendorSession): Promise<StoreShot[]> {
  const [gmail] = await openDemoPages(session);
  if (gmail === undefined) throw new Error('the demo pages did not open');
  await writeAway(session);
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  expect(await importActivity(panel, await previewActivity(panel, 'Muse', DEMO_LOG))).toBe(
    'Imported 2 claims.',
  );
  // Taken in this order, the reader broken last so the others show it well; named in the listing's order.
  const receipts = await receiptsShot(session);
  const detail = await detailShot(session);
  const grants = await grantsShot(session);
  const digest = await digestShot(session);
  const degraded = await degradedShot(session, gmail);
  return [
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
}

/** The 440×280 promo tile: the icon, the name and the one line. */
export function promoTile(context: BrowserContext): Promise<Buffer> {
  const icon = readFileSync(ICON).toString('base64');
  return draw(
    context,
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
