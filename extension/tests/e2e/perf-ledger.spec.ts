/**
 * The built extension over the 30-day ledger (sprint_6 6.4: "30-day synthetic ledger (5,000 claims, 50,000
 * observations): popup < 100 ms, grading pass < 2 s, IndexedDB size < 50 MB; service-worker idle memory measured"; and
 * "the paged JSON/CSV export of the 30-day synthetic ledger completes without a whole-table read and its time and peak
 * memory are measured"). The ledger is built as the service worker builds one (../perf/month-ledger.ts) and its stored
 * rows written into the extension's own IndexedDB. Gated here: Chrome's count of the origin's storage, under 50 MB, and
 * the popup's first paint, under 100 ms (the median of five, as the 5,000-receipt gate takes it); on GitHub's runner,
 * under CI's ceiling of 250 ms instead (Decisions [7.0]), while `pnpm bench` holds 100 ms on the reference machine. The
 * grading pass is gated in tests/perf/grading.perf.spec.ts (5,000 claims against 50,000 observations). Measured and
 * logged, and recorded by `pnpm bench` (bench/perf.ts): both exports' time, size and peak page heap, and the worker's
 * idle heap. And the same ledger sealed (Sprint 6 close, tech review TECH-12): the popup's first paint, gated as above;
 * the time to seal it and rebuild its database, its storage and the JSON export, measured.
 */
import { expect, test } from '@playwright/test';

import { launchExtension } from './support/extension';
import { monthPopupGateMs, PERF_POPUP_RUNS, PERF_STORAGE_GATE_BYTES } from './support/perf-gates';
import {
  buildMonthRows,
  PERF_ARGS,
  sealLedger,
  seedLedger,
  settledStorageBytes,
  serviceWorkerHeapBytes,
  storageBytes,
  timeExport,
} from './support/perf-ledger';
import { measurePopupPaint, medianOf } from './support/popup-paint';
import { MINUTE_MS } from './support/priya';

const STORAGE_GATE_BYTES = PERF_STORAGE_GATE_BYTES;
// 100 ms, or CI's ceiling on GitHub's runner (Decisions [7.0]); each title names the one it holds.
const POPUP_GATE_MS = monthPopupGateMs();
const POPUP_RUNS = PERF_POPUP_RUNS;
test(
  `the 30-day ledger: under 50 MB, the popup paints in under ${String(POPUP_GATE_MS)} ms, the exports and the idle worker measured`,
  { tag: '@perf' },
  async () => {
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
  },
);

test(
  `the 30-day ledger sealed: the job and rebuild timed, the popup paints in under ${String(POPUP_GATE_MS)} ms, the export measured (TECH-12)`,
  { tag: '@perf' },
  async () => {
    test.setTimeout(30 * 60_000);
    const rows = buildMonthRows(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);
    const extension = await launchExtension({ extraArgs: [...PERF_ARGS] });
    try {
      await seedLedger(extension, rows);
      const seal = await sealLedger(extension, 'an invented passphrase for the sealed month');
      const peak = await storageBytes(extension);
      // Measured, not gated: sealed values do not compress (Decisions [6.close], TECH-12); the 50 MB gate above is the
      // ledger's as it ships, unencrypted. Read once Chrome has compacted what the rebuild left, and the paint after it.
      const bytes = await settledStorageBytes(extension);
      const paint = medianOf(await measurePopupPaint(extension, POPUP_RUNS), 'firstPaintMs');
      const json = await timeExport(extension, 'Export ledger');
      console.log(
        `[perf-ledger sealed] job ${String(seal.jobMs)} ms, with the rebuild ${String(seal.totalMs)} ms; ` +
          `storage ${String(peak)} B at once, ${String(bytes)} B settled; popup first paint ${String(paint)} ms; ` +
          `JSON export ${String(json.ms)} ms, ${String(json.bytes)} B`,
      );
      expect(bytes).toBeGreaterThan(0);
      expect(paint).toBeLessThan(POPUP_GATE_MS);
      expect(json.bytes).toBeGreaterThan(0);
    } finally {
      await extension.close();
    }
  },
);
