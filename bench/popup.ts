/**
 * The popup's paint over 5,000 receipts (sprint_4 4.2 done-when: "paints in < 100 ms at 5,000 receipts (Playwright
 * trace, committed)"; Hard Rule 12): the extension is built from the committed tree, launched in Playwright's Chromium,
 * its ledger seeded with the 5,000 receipts of extension/tests/perf/ui-rows.ts, and the popup opened RUNS times, each
 * as a new document (extension/tests/e2e/support/popup-paint.ts, the measurement the end-to-end gate takes). Recorded:
 * the first paint (the skeleton rows, before the ledger is read) and the paint of the day (today's list), each from
 * the page's navigation start, and the page's main-thread CPU time to the paint of the day, with the median, min and
 * max of the runs. The gate is the end-to-end test's: the
 * median first paint under 100 ms (Decisions [4.2] says why the first paint). A paint is a moment the person sees, so
 * this gate is wall time, not CPU: the statistic its gate test takes. The Playwright trace of the runs is written to
 * bench/traces/popup-paint.zip, with this machine's paths written as placeholders (./trace-scrub.ts), and committed with
 * the results.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchExtension } from '../extension/tests/e2e/support/extension';
import { buildExtensionOnce } from '../extension/tests/tools/build-extension';
import {
  measurePopupPaint,
  medianOf,
  type PaintRun,
  seedReceipts,
} from '../extension/tests/e2e/support/popup-paint';
import { UI_RECEIPTS } from '../extension/tests/perf/ui-rows';
import type { MetricValue } from './results';
import { round } from './timing';
import { machinePlaces, scrubTrace } from './trace-scrub';

/** The popup's paint budget (sprint_4 4.2; agents/ux_engineer.md rule 9). */
export const POPUP_PAINT_GATE_MS = 100;
const RUNS = 5;
const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));
/** The trace of the measured runs, committed with the results. */
export const POPUP_TRACE = 'bench/traces/popup-paint.zip';

const spread = (runs: readonly PaintRun[], paint: 'cpuMs' | 'firstPaintMs' | 'dayPaintMs') => {
  const values = runs.map((run) => run[paint]);
  return {
    median: round(medianOf(runs, paint)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
};

export async function runPopupBench(): Promise<Readonly<Record<string, MetricValue>>> {
  buildExtensionOnce();
  const extension = await launchExtension();
  try {
    await seedReceipts(extension);
    await extension.context.tracing.start({ screenshots: false, snapshots: false, title: 'popup paint' });
    const runs = await measurePopupPaint(extension, RUNS);
    mkdirSync(path.join(BENCH_DIR, 'traces'), { recursive: true });
    const trace = path.join(BENCH_DIR, '..', POPUP_TRACE);
    await extension.context.tracing.stop({ path: trace });
    scrubTrace(trace, machinePlaces(path.join(BENCH_DIR, '..')));
    const agent = await (await extension.serviceWorker()).evaluate(() => navigator.userAgent);
    const first = spread(runs, 'firstPaintMs');
    const day = spread(runs, 'dayPaintMs');
    const cpu = spread(runs, 'cpuMs');
    return {
      popupReceipts: UI_RECEIPTS,
      popupRuns: RUNS,
      popupRows: Math.min(...runs.map(({ rows }) => rows)),
      popupFirstPaintMedianMs: first.median,
      popupFirstPaintMinMs: first.min,
      popupFirstPaintMaxMs: first.max,
      popupDayPaintMedianMs: day.median,
      popupDayPaintMinMs: day.min,
      popupDayPaintMaxMs: day.max,
      popupCpuMedianMs: cpu.median,
      popupCpuMinMs: cpu.min,
      popupCpuMaxMs: cpu.max,
      popupChromeMajor: /Chrome\/(\d+)/u.exec(agent)?.[1] ?? 'unknown',
      popupTrace: POPUP_TRACE,
      popupPaintGateMs: POPUP_PAINT_GATE_MS,
      popupPaintGateMetric: 'popupFirstPaintMedianMs',
      popupPaintGatePassed: medianOf(runs, 'firstPaintMs') < POPUP_PAINT_GATE_MS,
    };
  } finally {
    await extension.close();
  }
}
