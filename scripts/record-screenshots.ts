/**
 * `pnpm record-screenshots` (sprint_7 7.4): the store listing's five screenshots, `launch/screenshots/*.png` at
 * 1280×800, and its promo tile, `launch/promo-tile.png` at 440×280, as launch/store-listing.md lists them. It builds the
 * extension and has Playwright take them on the built extension and saved test pages with invented names
 * (extension/tests/e2e/store-shots.record.ts, run by extension/playwright.record.config.ts), each page's text checked
 * for seeded secrets and real addresses first. They are written to a temporary folder and copied only once all six are
 * made, so a run that fails leaves the committed pictures as they were.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCREENSHOTS = [
  '1-receipts.png',
  '2-receipt-detail.png',
  '3-grants.png',
  '4-degraded.png',
  '5-digest.png',
];
const TILE = 'promo-tile.png';

const made = mkdtempSync(path.join(os.tmpdir(), 'attest-shots-'));
try {
  execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.record.config.ts',
      'tests/e2e/store-shots.record.ts',
    ],
    {
      cwd: path.join(ROOT, 'extension'),
      stdio: 'inherit',
      env: { ...process.env, ATTEST_STORE_SHOTS: made },
    },
  );
  const files = readdirSync(made);
  const missing = [...SCREENSHOTS, TILE].filter((file) => !files.includes(file));
  if (missing.length > 0) throw new Error(`record-screenshots: not made: ${missing.join(', ')}`);
  mkdirSync(path.join(ROOT, 'launch', 'screenshots'), { recursive: true });
  for (const file of SCREENSHOTS)
    copyFileSync(path.join(made, file), path.join(ROOT, 'launch', 'screenshots', file));
  copyFileSync(path.join(made, TILE), path.join(ROOT, 'launch', TILE));
  console.log(`record-screenshots: launch/screenshots/ (${String(SCREENSHOTS.length)}) and launch/${TILE}`);
} finally {
  rmSync(made, { recursive: true, force: true });
}
