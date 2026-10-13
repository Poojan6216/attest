/**
 * The popup's paint over 5,000 receipts on the built extension (sprint_4 4.2 done-when: "paints in < 100 ms at 5,000
 * receipts"; agents/ux_engineer.md rule 9: skeleton rows, and the popup paints in under 100 ms, the ledger read paged),
 * shared by tests/e2e/popup.spec.ts (the gate) and bench/popup.ts (the numbers RESULTS.md records).
 *
 * The rows of tests/perf/ui-rows.ts, FINAL so that no grading batch regrades them while the popup is measured, the
 * newest graded at local noon today (so today holds at least 1,440 of them whatever the hour), are written into the
 * extension's own ledger from its popup page, once the popup has opened the ledger, a thousand rows a call. Then the
 * popup loads again and again, each run a new document, and each run reads the page's main-thread CPU time from its
 * navigation to the paint of the day (the gated number: CPU time, as every perf gate here, Decisions [1.perf], since a
 * busy machine does not inflate it the way it inflates wall time), and two paints, from the page's navigation start
 * (the time a person waits from the click): its first paint (Paint Timing `first-contentful-paint`: the skeleton rows,
 * drawn while the ledger is read), and the paint of the day (the Element Timing entry `today` of its heading, which the
 * popup draws in the same frame as today's list). Decisions [4.2] says why.
 */
import type { CDPSession, Page } from '@playwright/test';

import { POPUP_RECEIPT_LIMIT } from '../../../src/config';
import { uiRows } from '../../perf/ui-rows';
import type { LaunchedExtension } from './extension';
import { putRawRows } from './raw-ledger';

export interface PaintRun {
  /** The popup page's main-thread CPU time from its navigation to the paint of the day, in ms (the gated number). */
  readonly cpuMs: number;
  /** From the popup's navigation start to its first paint (the skeleton rows), in ms. */
  readonly firstPaintMs: number;
  /** From the popup's navigation start to Chrome painting the day (today's list), in ms. */
  readonly dayPaintMs: number;
  /** The receipts the list showed. */
  readonly rows: number;
}

/** Local noon today, in the zone this process and the browser share. */
function noonToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
}

/** Rows written per call, so no one message between the test and the page carries the whole ledger. */
const CHUNK = 1_000;

/** Writes `rows` into one store of the extension's ledger, from `page`, in one transaction (./raw-ledger.ts). */
async function putRows(page: Page, store: 'receipts' | 'claims', rows: readonly unknown[]): Promise<void> {
  await putRawRows(page, store, rows);
}

/** Writes the 5,000 receipts and their claims into the extension's ledger, from its popup page (header). */
export async function seedReceipts(extension: LaunchedExtension): Promise<void> {
  const { receipts, claims } = uiRows(noonToday(), 'FINAL');
  // The popup opens the ledger (schema and all) on its first read: an empty day says it has.
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${extension.extensionId}/popup.html`);
  await page.getByRole('status').filter({ hasText: 'No receipts today' }).waitFor();
  for (const [store, rows] of [
    ['receipts', receipts],
    ['claims', claims],
  ] as const) {
    for (let at = 0; at < rows.length; at += CHUNK) await putRows(page, store, rows.slice(at, at + CHUNK));
  }
  await page.close();
}

/**
 * When Chrome first painted the popup, and when it painted the day, from its navigation start (header). Both are read
 * through observers with their buffered entries: Chrome adds a paint's entry once the frame is presented, which can
 * come after the rows are in the page.
 */
async function paintsOf(page: Page): Promise<{ readonly first: number; readonly day: number }> {
  // No named function inside: the evaluated code runs in the page, where a bundler's name helper does not exist.
  return page.evaluate(
    () =>
      new Promise<{ first: number; day: number }>((resolve, reject) => {
        const seen: { first: number | null; day: number | null } = { first: null, day: null };
        new PerformanceObserver((list) => {
          const entry = list.getEntriesByName('first-contentful-paint')[0];
          if (entry !== undefined) seen.first = entry.startTime;
          if (seen.first !== null && seen.day !== null) resolve({ first: seen.first, day: seen.day });
        }).observe({ type: 'paint', buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if ('identifier' in entry && entry.identifier === 'today' && 'renderTime' in entry) {
              seen.day = Number(entry.renderTime) || entry.startTime;
            }
          }
          if (seen.first !== null && seen.day !== null) resolve({ first: seen.first, day: seen.day });
        }).observe({ type: 'element', buffered: true });
        setTimeout(() => {
          reject(
            new Error(
              `Chrome reported no ${seen.first === null ? 'first paint' : 'paint of the day'} of the popup`,
            ),
          );
        }, 5_000);
      }),
  );
}

/** The page's main-thread CPU time since its document started, in ms (CDP Performance.getMetrics `ThreadTime`, s). */
async function threadMs(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const thread = metrics.find((metric) => metric.name === 'ThreadTime');
  if (thread === undefined) throw new Error('CDP reported no ThreadTime');
  return thread.value * 1_000;
}

/**
 * Opens the popup once to warm it (Chrome caches its compiled scripts, as it does for a popup opened every day), then
 * loads it again `runs` times, each a new document in the same page, and reads each run's main-thread CPU time and its
 * two paints (header). Waiting for the rows polls the page a little, so the CPU time errs high, never low.
 */
export async function measurePopupPaint(extension: LaunchedExtension, runs: number): Promise<PaintRun[]> {
  const page = await extension.context.newPage();
  const rows = page.locator('li[data-receipt]');
  await page.goto(`chrome-extension://${extension.extensionId}/popup.html`);
  await rows.nth(POPUP_RECEIPT_LIMIT - 1).waitFor();
  const cdp = await extension.context.newCDPSession(page);
  await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
  const measured: PaintRun[] = [];
  for (let run = 0; run < runs; run += 1) {
    await page.reload();
    await rows.nth(POPUP_RECEIPT_LIMIT - 1).waitFor();
    const { first, day } = await paintsOf(page);
    // Chrome restarts a page's metrics with each new document, so this is the CPU time since the popup's navigation.
    const cpuMs = await threadMs(cdp);
    measured.push({ cpuMs, firstPaintMs: first, dayPaintMs: day, rows: await rows.count() });
  }
  await cdp.detach();
  await page.close();
  return measured;
}

/** The middle of the runs' `paint` (the upper one of an even count), as the perf gates take a median. */
export function medianOf(runs: readonly PaintRun[], paint: 'cpuMs' | 'firstPaintMs' | 'dayPaintMs'): number {
  const sorted = runs.map((run) => run[paint]).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** One line for the log: the medians and every run. */
export function describePaints(runs: readonly PaintRun[]): string {
  const each = runs.map(
    (run, at) =>
      `run ${String(at + 1)} ${run.cpuMs.toFixed(1)} ms CPU, first ${run.firstPaintMs.toFixed(1)} ms, day ${run.dayPaintMs.toFixed(1)} ms`,
  );
  const medians = [
    `median ${medianOf(runs, 'cpuMs').toFixed(1)} ms CPU`,
    `first paint ${medianOf(runs, 'firstPaintMs').toFixed(1)} ms`,
    `day ${medianOf(runs, 'dayPaintMs').toFixed(1)} ms`,
  ].join(', ');
  return `perf gate: popup at 5000 receipts: ${medians} (${each.join('; ')})`;
}
