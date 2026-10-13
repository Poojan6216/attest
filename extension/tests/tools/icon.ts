/**
 * Attest's icon as Chromium draws it (sprint_7 7.4; Sprint 7 close, QA review QA-16): extension/assets/icon.svg, a
 * receipt with a check mark on a dark rounded square, drawn at each size the manifest names, on a transparent ground so
 * the corners stay clear. `pnpm render-icons` (./render-icons.ts) writes what this draws to extension/public/icon/; the
 * end-to-end test of the launch's pictures (tests/e2e/launch-shots.spec.ts) draws it again and holds the committed
 * files to it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

export const EXTENSION_DIR = path.resolve(import.meta.dirname, '../..');
export const ICON_SIZES = [16, 32, 48, 96, 128] as const;
const SVG = readFileSync(path.join(EXTENSION_DIR, 'assets', 'icon.svg'), 'utf8');

/** Where the icon of `size` is kept. */
export const iconFile = (size: number): string =>
  path.join(EXTENSION_DIR, 'public', 'icon', `${String(size)}.png`);

/** The icon at `size`, drawn by `page` (a page of a browser at device scale 1), as a PNG. */
export async function renderIcon(page: Page, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><html><head><style>html, body { margin: 0; background: transparent; }
    svg { display: block; width: ${String(size)}px; height: ${String(size)}px; }</style></head><body>${SVG}</body></html>`,
  );
  return page.screenshot({ omitBackground: true });
}
