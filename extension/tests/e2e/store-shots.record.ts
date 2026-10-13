/**
 * The store listing's five screenshots and its promo tile (sprint_7 7.4; `pnpm record-screenshots`, which runs this with
 * playwright.record.config.ts): ./support/launch-shots.ts `storeShots`, Attest's own pages on the built extension after
 * the build_spec §2 demo's flow on saved test pages with invented names, every page checked for seeded secrets and real
 * addresses first, which ./launch-shots.spec.ts runs in `pnpm e2e` too. Each screenshot is 1280×800, the page centred
 * above a one-line caption, as the demo's frames are (./support/frames.ts); the promo tile is 440×280. Written to
 * ATTEST_STORE_SHOTS, as listed in launch/store-listing.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test } from '@playwright/test';

import { compose } from './support/frames';
import { promoTile, storeShots } from './support/launch-shots';
import { withVendorSession } from './support/session';

test('the store listing’s screenshots and promo tile', async () => {
  test.setTimeout(6 * 60_000);
  const out = process.env.ATTEST_STORE_SHOTS;
  if (out === undefined) throw new Error('ATTEST_STORE_SHOTS names no folder: run `pnpm record-screenshots`');
  mkdirSync(out, { recursive: true });
  await withVendorSession(async (session) => {
    for (const [file, frame] of await storeShots(session)) {
      writeFileSync(path.join(out, file), await compose(session.extension.context, frame));
    }
    writeFileSync(path.join(out, 'promo-tile.png'), await promoTile(session.extension.context));
  });
});
