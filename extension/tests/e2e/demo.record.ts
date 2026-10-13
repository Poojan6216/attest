/**
 * The build_spec §2 demo as six captioned frames for launch/demo.gif (sprint_7 7.3; `pnpm record-demo`, which runs this
 * with playwright.record.config.ts and turns the frames into the GIF). The frames are ./support/launch-shots.ts
 * `demoFrames`, every page in them checked for seeded secrets and real addresses first, which ./launch-shots.spec.ts
 * runs in `pnpm e2e` too: the request, Muse's log pasted into the side panel, the Gmail Sent folder and the Calendar
 * week Attest reads, the popup's three receipts, and the week's digest. Each is a 1280×800 PNG (./support/frames.ts)
 * written to ATTEST_DEMO_FRAMES as frame-1.png to frame-6.png, its caption below. Not an end-to-end test: `pnpm e2e`
 * runs `*.spec.ts` only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { test } from '@playwright/test';

import { compose } from './support/frames';
import { demoFrames } from './support/launch-shots';
import { withVendorSession } from './support/session';

test('the §2 demo, recorded as six captioned frames', async () => {
  test.setTimeout(5 * 60_000);
  const out = process.env.ATTEST_DEMO_FRAMES;
  if (out === undefined) throw new Error('ATTEST_DEMO_FRAMES names no folder: run `pnpm record-demo`');
  mkdirSync(out, { recursive: true });
  await withVendorSession(async (session) => {
    for (const [index, frame] of (await demoFrames(session)).entries()) {
      writeFileSync(
        path.join(out, `frame-${String(index + 1)}.png`),
        await compose(session.extension.context, frame),
      );
    }
  });
});
