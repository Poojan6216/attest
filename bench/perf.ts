/**
 * The performance and memory bench (sprint_6 6.4; Hard Rule 12): the built extension measured where 6.4 gates it and
 * where it only measures.
 *  - The Gmail Sent reader on a generated head of 10,000 rows: one pass of the shipped reader (the median of three fresh
 *    loads; gate under 2 s), the time the built extension takes to store the rows, and what its ledger holds after
 *    reading the page twice (each row once, one Sent window).
 *  - The 30-day ledger (extension/tests/perf/month-ledger.ts: 5,000 claims, 50,000 observations, their receipts and
 *    replay records) in the extension's own IndexedDB: Chrome's count of the origin's storage (gate under 50 MB), the
 *    popup's first paint (the median of five; gate under 100 ms), each export's time, size and peak page heap
 *    (uncollected garbage included), and the service worker's heap once idle.
 * The grading pass's gate, 5,000 claims against 50,000 observations, is the core bench's (`gradingGatePassed`). The same
 * measures gate the end-to-end tests extension/tests/e2e/perf-gmail.spec.ts and perf-ledger.spec.ts.
 */

import { launchExtension } from '../extension/tests/e2e/support/extension';
import { readTwice, timeSentPasses } from '../extension/tests/e2e/support/perf-gmail';
import {
  buildMonthRows,
  PERF_ARGS,
  seedLedger,
  serviceWorkerHeapBytes,
  storageBytes,
  timeExport,
} from '../extension/tests/e2e/support/perf-ledger';
import { measurePopupPaint, medianOf } from '../extension/tests/e2e/support/popup-paint';
import type { MetricValue } from './results';
import { round } from './timing';
import { buildExtension } from '../extension/tests/tools/build-extension';

export const PERF_GMAIL_ROWS = 10_000;
export const PERF_GMAIL_PASS_GATE_MS = 2_000;
export const PERF_STORAGE_GATE_BYTES = 50_000_000;
export const PERF_POPUP_GATE_MS = 100;
const PASS_RUNS = 3;
const POPUP_RUNS = 5;

async function gmailMetrics(): Promise<Record<string, MetricValue>> {
  const times = (await timeSentPasses(PERF_GMAIL_ROWS, PASS_RUNS))
    .map((pass) => pass.ms)
    .sort((a, b) => a - b);
  const median = times[Math.floor(PASS_RUNS / 2)] ?? Number.POSITIVE_INFINITY;
  const reads = await readTwice(PERF_GMAIL_ROWS);
  return {
    perfGmailRows: PERF_GMAIL_ROWS,
    perfGmailPassMedianMs: round(median),
    perfGmailPassMinMs: round(times[0] ?? median),
    perfGmailPassMaxMs: round(times.at(-1) ?? median),
    perfGmailPassGateMs: PERF_GMAIL_PASS_GATE_MS,
    perfGmailPassGatePassed: median < PERF_GMAIL_PASS_GATE_MS,
    perfGmailStoreMs: reads.storeMs,
    perfGmailRowsAfterTwoReads: reads.afterSecond,
    perfGmailSentWindows: reads.windows,
  };
}

async function monthMetrics(): Promise<Record<string, MetricValue>> {
  const rows = buildMonthRows(Math.floor(Date.now() / 60_000) * 60_000);
  const extension = await launchExtension({ extraArgs: [...PERF_ARGS] });
  try {
    await seedLedger(extension, rows);
    const bytes = await storageBytes(extension);
    const paint = medianOf(await measurePopupPaint(extension, POPUP_RUNS), 'firstPaintMs');
    const json = await timeExport(extension, 'Export ledger');
    const csv = await timeExport(extension, 'Export receipts');
    return {
      perfMonthClaims: rows.claims?.length ?? 0,
      perfMonthObservations: rows.observations?.length ?? 0,
      perfMonthStorageBytes: bytes,
      perfMonthStorageGateBytes: PERF_STORAGE_GATE_BYTES,
      perfMonthStorageGatePassed: bytes > 0 && bytes < PERF_STORAGE_GATE_BYTES,
      perfMonthPopupFirstPaintMedianMs: round(paint),
      perfMonthPopupGateMs: PERF_POPUP_GATE_MS,
      perfMonthPopupGatePassed: paint < PERF_POPUP_GATE_MS,
      perfExportJsonMs: json.ms,
      perfExportJsonBytes: json.bytes,
      perfExportJsonPeakHeapBytes: json.peakHeapBytes,
      perfExportCsvMs: csv.ms,
      perfExportCsvBytes: csv.bytes,
      perfExportCsvPeakHeapBytes: csv.peakHeapBytes,
      perfWorkerIdleHeapBytes: await serviceWorkerHeapBytes(extension),
    };
  } finally {
    await extension.close();
  }
}

export async function runPerfBench(): Promise<Readonly<Record<string, MetricValue>>> {
  buildExtension();
  return { ...(await gmailMetrics()), ...(await monthMetrics()) };
}
