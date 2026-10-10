/**
 * The built extension over the 30-day ledger (sprint_6 6.4: "30-day synthetic ledger (5,000 claims, 50,000
 * observations): popup < 100 ms, grading pass < 2 s, IndexedDB size < 50 MB; service-worker idle memory measured"; and
 * "the paged JSON/CSV export of the 30-day synthetic ledger completes without a whole-table read and its time and peak
 * memory are measured"). The ledger is built as the service worker builds one (../perf/month-ledger.ts) and its stored
 * rows written into the extension's own IndexedDB. Gated here: Chrome's count of the origin's storage, under 50 MB, and
 * the popup's first paint, under 100 ms (the median of five, as the 5,000-receipt gate takes it). The grading pass is
 * gated in tests/perf/grading.perf.spec.ts (5,000 claims against 50,000 observations). Measured and logged, and
 * recorded by `pnpm bench` (bench/perf.ts): both exports' time, size and peak page heap, and the worker's idle heap.
 */
import { expect, test } from '@playwright/test';

import { launchExtension } from './support/extension';
import {
  buildMonthRows,
  PERF_ARGS,
  seedLedger,
  serviceWorkerHeapBytes,
  storageBytes,
  timeExport,
} from './support/perf-ledger';
import { measurePopupPaint, medianOf } from './support/popup-paint';
import { MINUTE_MS } from './support/priya';

/** The sprint's bound on the ledger's size, in bytes: 50 MB, counted in thousands, the stricter count. */
const STORAGE_GATE_BYTES = 50_000_000;
/** The popup's paint budget (sprint_4 4.2), now at the month's ledger. */
const POPUP_GATE_MS = 100;
const POPUP_RUNS = 5;
test('the 30-day ledger: under 50 MB, the popup paints in under 100 ms, the exports and the idle worker measured', async () => {
  test.setTimeout(15 * 60_000);
  const rows = buildMonthRows(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);
  const extension = await launchExtension({ extraArgs: [...PERF_ARGS] });
  try {
    await seedLedger(extension, rows);
    const bytes = await storageBytes(extension);
    const paint = medianOf(await measurePopupPaint(extension, POPUP_RUNS), 'firstPaintMs');
    const json = await timeExport(extension, 'Export ledger');
    const csv = await timeExport(extension, 'Export receipts');
    const idleHeap = await serviceWorkerHeapBytes(extension);
    console.log(
      `[perf-ledger] storage ${String(bytes)} B; popup first paint ${String(paint)} ms; ` +
        `JSON export ${String(json.ms)} ms, ${String(json.bytes)} B, peak heap +${String(json.peakHeapBytes)} B; ` +
        `CSV export ${String(csv.ms)} ms, ${String(csv.bytes)} B, peak heap +${String(csv.peakHeapBytes)} B; ` +
        `worker idle heap ${String(idleHeap)} B`,
    );
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(STORAGE_GATE_BYTES);
    expect(paint).toBeLessThan(POPUP_GATE_MS);
    expect(json.bytes).toBeGreaterThan(0);
    expect(csv.bytes).toBeGreaterThan(0);
    expect(idleHeap).toBeGreaterThan(0);
  } finally {
    await extension.close();
  }
});
