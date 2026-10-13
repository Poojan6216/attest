/**
 * The build_spec §2 demo as six captioned frames for launch/demo.gif (sprint_7 7.3; `pnpm record-demo`, which runs this
 * with playwright.demo.config.ts and turns the frames into the GIF). It drives the same flow as the demo's end-to-end
 * test (./demo-paste.spec.ts) on the built extension and the same invented pages: the request, Muse's log pasted into
 * the side panel, the Gmail Sent folder and the Calendar week Attest reads, the popup's three receipts, and the week's
 * digest. Each step waits for what it shows, so a flow that breaks fails here rather than recording a wrong frame. The
 * frames are 1280×800 PNGs written to ATTEST_DEMO_FRAMES as frame-1.png to frame-6.png, each with its caption below.
 * Not an end-to-end test: `pnpm e2e` runs `*.spec.ts` only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { DEMO_LOG } from './support/demo';
import { openDemoPages, writeAway } from './support/demo-flow';
import { makeDigestNow } from './support/digest';
import { type VendorSession, withVendorSession } from './support/session';

const FRAME = { width: 1280, height: 800 } as const;
const CAPTION_HEIGHT = 96;
const SHOT = { width: FRAME.width, height: FRAME.height - CAPTION_HEIGHT } as const;
/** The width the popup and the side panel are drawn at in Chrome. */
const PANEL = { width: 400, height: SHOT.height } as const;

interface Frame {
  readonly caption: string;
  /** A screenshot to show above the caption, or none for the request, whose words are the frame. */
  readonly image?: Buffer;
  readonly words?: string;
}

const escape = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char,
  );

/** `frame` drawn at 1280×800: its screenshot or words above, its caption in a bar below. */
async function compose(session: VendorSession, frame: Frame): Promise<Buffer> {
  const page = await session.extension.context.newPage();
  await page.setViewportSize(FRAME);
  const top =
    frame.image === undefined
      ? `<p class="words">${escape(frame.words ?? '')}</p>`
      : `<img src="data:image/png;base64,${frame.image.toString('base64')}" alt="">`;
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; width: ${String(FRAME.width)}px; height: ${String(FRAME.height)}px; overflow: hidden; }
    body { display: flex; flex-direction: column; background: #e8eaed; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .shot { height: ${String(SHOT.height)}px; display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; max-height: 100%; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25); }
    .words { margin: 0 96px; font-size: 44px; line-height: 1.35; color: #202124; text-align: center; }
    .caption { height: ${String(CAPTION_HEIGHT)}px; box-sizing: border-box; padding: 0 40px; display: flex; align-items: center;
      background: #202124; color: #fff; font-size: 26px; line-height: 1.3; }
  </style></head><body><div class="shot">${top}</div><div class="caption">${escape(frame.caption)}</div></body></html>`);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  return png;
}

/** A screenshot of `page` at `size`. */
async function shoot(page: Page, size: { readonly width: number; readonly height: number }): Promise<Buffer> {
  await page.setViewportSize(size);
  await page.bringToFront();
  return page.screenshot({ type: 'png' });
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
async function weekFrame(calendar: Page): Promise<Buffer> {
  await calendar.setViewportSize(SHOT);
  await calendar.addStyleTag({ content: WEEK_LAYOUT });
  await expect(calendar.locator('[data-eventid]')).toHaveCount(0);
  return calendar.locator('[role="main"]').screenshot({ type: 'png' });
}

/** The side panel with Muse's log pasted and previewed, shot before the import, which this then makes. */
async function pastedFrame(session: VendorSession): Promise<Buffer> {
  const panel = await session.extension.openExtensionPage('sidepanel.html');
  await panel.setViewportSize(PANEL);
  await panel.getByRole('button', { name: 'Add agent activity' }).click();
  await panel.getByRole('radio', { name: 'Muse' }).check();
  await panel.getByLabel('Activity log').fill(DEMO_LOG);
  await panel.getByRole('button', { name: 'Preview' }).click();
  const importButton = panel.getByRole('button', { name: 'Import 2 claims' });
  await expect(importButton).toBeVisible();
  const shot = await shoot(panel, PANEL);
  await importButton.click();
  await expect(panel.getByRole('status').filter({ hasText: /^Imported 2 claims/u })).toBeVisible({
    timeout: 30_000,
  });
  return shot;
}

/** The popup once it shows the demo's three receipts. */
async function receiptsFrame(session: VendorSession): Promise<Buffer> {
  const popup = await session.extension.openExtensionPage('popup.html');
  await popup.setViewportSize(PANEL);
  const receipts = popup.locator('li[data-receipt]');
  for (const grade of ['Verified', 'Not found', 'Unasked']) {
    await expect(receipts.filter({ hasText: `Grade: ${grade}` })).toHaveCount(1);
  }
  return shoot(popup, PANEL);
}

/** The week's digest page, once the digest alarm has made it. */
async function digestFrame(session: VendorSession): Promise<Buffer> {
  await makeDigestNow(session.extension, session.ledgerPage);
  const digest = await session.extension.openExtensionPage('digest.html');
  await expect(digest.getByText('Likely agent').first()).toBeVisible();
  return shoot(digest, SHOT);
}

test('the §2 demo, recorded as six captioned frames', async () => {
  test.setTimeout(5 * 60_000);
  const out = process.env.ATTEST_DEMO_FRAMES;
  if (out === undefined) throw new Error('ATTEST_DEMO_FRAMES names no folder: run `pnpm record-demo`');
  mkdirSync(out, { recursive: true });
  await withVendorSession(async (session) => {
    const [gmail, calendar] = await openDemoPages(session);
    if (gmail === undefined || calendar === undefined) throw new Error('the demo pages did not open');
    await writeAway(session);
    const pasted = await pastedFrame(session);
    const graded = await receiptsFrame(session);
    const week = await digestFrame(session);
    const frames: Frame[] = [
      {
        words: '“Email Priya the Q3 deck. Put a review on the calendar.”',
        caption: 'You ask Muse, your AI agent, to send an email and to add a calendar event.',
      },
      {
        image: pasted,
        caption: "Muse says it did both. You paste its activity log into Attest's side panel.",
      },
      {
        image: await shoot(gmail, SHOT),
        caption:
          'You open your Gmail Sent folder, here a saved test page. Attest reads it, and changes nothing.',
      },
      {
        image: await weekFrame(calendar),
        caption: 'You open Calendar, also a saved test page. No “Q3 review” in the week.',
      },
      {
        image: graded,
        caption:
          'Receipts: the email Verified, the event Not found, and a send to a vendor nobody asked for: Unasked, likely agent.',
      },
      { image: week, caption: "Each week's digest sums up what every agent claimed, and what Attest found." },
    ];
    for (const [index, frame] of frames.entries()) {
      writeFileSync(path.join(out, `frame-${String(index + 1)}.png`), await compose(session, frame));
    }
  });
});
