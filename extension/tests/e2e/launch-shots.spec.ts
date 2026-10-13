/**
 * The launch's pictures, made in `pnpm e2e` and written nowhere (Sprint 7 close: tech review TECH-7, QA review QA-9 and
 * QA-16): the demo's six frames and the store's five screenshots are made by the same flows their recorders run
 * (./support/launch-shots.ts), so a change that breaks a recorder fails here, and every page in them passes the
 * invented-data check before its picture (no seeded secret, only addresses at reserved domains), the demo's vendor test
 * pages among them. Each frame composes to 1280×800 with its caption. And the icons are Attest's SVG as Chromium draws
 * it (extension/tests/tools/icon.ts), at each size, their corners clear.
 */
import { readFileSync } from 'node:fs';

import { chromium, expect, type Page, test } from '@playwright/test';

import { ICON_SIZES, iconFile, renderIcon } from '../tools/icon';
import { compose, FRAME } from './support/frames';
import { demoFrames, promoTile, storeShots } from './support/launch-shots';
import { withVendorSession } from './support/session';

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (png: Buffer): readonly [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)];

test.describe('the launch pictures, made and written nowhere', () => {
  test.setTimeout(6 * 60_000);

  test("the demo's six frames: every page invented, each frame 1280×800 with its caption", async () => {
    await withVendorSession(async (session) => {
      const frames = await demoFrames(session);
      expect(frames.map((frame) => frame.caption)).toHaveLength(6);
      for (const frame of frames) {
        expect(pngSize(await compose(session.extension.context, frame))).toEqual([FRAME.width, FRAME.height]);
      }
    });
  });

  test("the store's five screenshots and its tile: every page invented, each at its size", async () => {
    await withVendorSession(async (session) => {
      const shots = await storeShots(session);
      expect(shots.map(([file]) => file)).toEqual([
        '1-receipts.png',
        '2-receipt-detail.png',
        '3-grants.png',
        '4-degraded.png',
        '5-digest.png',
      ]);
      for (const [, frame] of shots) {
        expect(pngSize(await compose(session.extension.context, frame))).toEqual([FRAME.width, FRAME.height]);
      }
      expect(pngSize(await promoTile(session.extension.context))).toEqual([440, 280]);
    });
  });
});

const dataUrl = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

/** How `drawn` and `kept` differ, read by `page` from both PNGs: their sizes, the pixels apart, `kept`'s corners. */
function compare(page: Page, drawn: Buffer, kept: Buffer) {
  return page.evaluate(
    async ([one, two]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            resolve(image);
          };
          image.onerror = reject;
          image.src = src;
        });
      const pixels = (image: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = [image.width, image.height];
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('no 2d context');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [a, b] = await Promise.all([load(one), load(two)]);
      const [x, y] = [pixels(a), pixels(b)];
      let apart = 0;
      for (let at = 0; at < x.length; at += 4) {
        if ([0, 1, 2, 3].some((channel) => Math.abs((x[at + channel] ?? 0) - (y[at + channel] ?? 0)) > 32))
          apart += 1;
      }
      const w = b.width;
      const corners = [0, w - 1, (b.height - 1) * w, b.height * w - 1].map((pixel) => y[pixel * 4 + 3] ?? -1);
      return { sizes: [a.width, a.height, b.width, b.height], apart, corners };
    },
    [dataUrl(drawn), dataUrl(kept)] as const,
  );
}

test('the icons are the SVG as Chromium draws it, at each size, corners clear', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const size of ICON_SIZES) {
      const drawn = await renderIcon(page, size);
      await page.setContent('<!doctype html><title>compare</title>');
      const { sizes, apart, corners } = await compare(page, drawn, readFileSync(iconFile(size)));
      expect(sizes, `${String(size)} px`).toEqual([size, size, size, size]);
      // Drawn here and drawn on the founder's machine, edges may round apart by a shade; the shape may not.
      expect(apart / (size * size), `${String(size)} px`).toBeLessThanOrEqual(0.02);
      // Clear: at most a shade of the rounded square's edge, never its ground (alpha out of 255).
      for (const alpha of corners) expect(alpha, `${String(size)} px`).toBeLessThanOrEqual(16);
    }
  } finally {
    await browser.close();
  }
});
