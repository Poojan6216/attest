/**
 * `pnpm render-icons` (sprint_7 7.4): Attest's icon, drawn once as extension/assets/icon.svg (a receipt with a check
 * mark), rendered by Chromium into the PNG sizes the manifest names, extension/public/icon/<size>.png, with clear
 * corners. Run it after changing the SVG; the store's promo tile and screenshots take the 128 px one
 * (`pnpm record-screenshots`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SVG = readFileSync(path.join(ROOT, 'extension', 'assets', 'icon.svg'), 'utf8');
const SIZES = [16, 32, 48, 96, 128] as const;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><head><style>html, body { margin: 0; background: transparent; }
      svg { display: block; width: ${String(size)}px; height: ${String(size)}px; }</style></head><body>${SVG}</body></html>`,
    );
    await page.screenshot({
      path: path.join(ROOT, 'extension', 'public', 'icon', `${String(size)}.png`),
      omitBackground: true,
    });
  }
  console.log(`render-icons: extension/public/icon/{${SIZES.join(',')}}.png`);
} finally {
  await browser.close();
}
