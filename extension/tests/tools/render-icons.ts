/**
 * `pnpm render-icons` (sprint_7 7.4): Attest's icon (./icon.ts), drawn once as extension/assets/icon.svg and rendered by
 * Chromium into the PNG sizes the manifest names, extension/public/icon/<size>.png, with clear corners. Run it after
 * changing the SVG; the store's promo tile and screenshots take the 128 px one (`pnpm record-screenshots`). It lives
 * with the extension's tools because it needs `@playwright/test`, which only the extension depends on (Decisions
 * [7.close]).
 */
import { writeFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

import { ICON_SIZES, iconFile, renderIcon } from './icon';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of ICON_SIZES) writeFileSync(iconFile(size), await renderIcon(page, size));
  console.log(`render-icons: extension/public/icon/{${ICON_SIZES.join(',')}}.png`);
} finally {
  await browser.close();
}
