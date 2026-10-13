/**
 * Perf gate (sprint_4 4.2 done-when: "paints in < 100 ms at 5,000 receipts"; agents/ux_engineer.md rule 9: skeleton
 * rows, and the popup paints in under 100 ms, the ledger read paged). In Playwright's Chromium on the extension built
 * from this tree, over the 5,000 receipts of tests/e2e/support/popup-paint.ts: the popup paints before the ledger is
 * read (its skeleton rows), its median first paint over five loads is under 100 ms from its navigation start, and every
 * load shows a full page of today's receipts. The paint of the day and the page's main-thread CPU time are logged
 * beside it, and bench/popup.ts records all three in RESULTS.md (Decisions [4.2] says why the gate is the first paint).
 *
 * A paint is a moment the person sees, so it is wall time, which a test running beside it inflates (two parallel
 * end-to-end workers pushed the first paint to 100-120 ms): it is timed here, with the other perf gates, serial and in
 * one process (vitest.perf.config.ts), never in the parallel end-to-end run.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POPUP_RECEIPT_LIMIT } from '../../src/config';
import { launchExtension, type LaunchedExtension } from '../e2e/support/extension';
import { describePaints, measurePopupPaint, medianOf, seedReceipts } from '../e2e/support/popup-paint';
import { buildExtension } from '../tools/build-extension';

/** The popup's paint budget, from its navigation start (sprint_4 4.2). */
const PAINT_GATE_MS = 100;
const RUNS = 5;

let extension: LaunchedExtension | undefined;

beforeAll(async () => {
  buildExtension();
  extension = await launchExtension();
  await seedReceipts(extension);
}, 300_000);

afterAll(async () => {
  await extension?.close();
});

describe('the popup at 5,000 receipts', () => {
  it(`paints in under ${String(PAINT_GATE_MS)} ms, before the ledger is read, with a full page of today`, async () => {
    if (extension === undefined) throw new Error('the extension did not launch');
    const runs = await measurePopupPaint(extension, RUNS);
    console.log(describePaints(runs));
    expect(runs.map(({ rows }) => rows)).toEqual(runs.map(() => POPUP_RECEIPT_LIMIT));
    // The popup paints (its skeleton rows) before the ledger is read, never after (ux_engineer rule 9).
    for (const run of runs) expect(run.firstPaintMs).toBeLessThanOrEqual(run.dayPaintMs);
    expect(medianOf(runs, 'firstPaintMs')).toBeLessThan(PAINT_GATE_MS);
  }, 120_000);
});
