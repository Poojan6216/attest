/**
 * Perf gate, sprint 2 task 2.2 (qa_tester rule 7: "Gmail fixture 10,000 rows < 2 s"; a perf gate is a test, not a
 * note). Added by the Sprint 2 QA review: the Sent observer had no perf gate.
 *
 * Why a browser test: the gate is about the observer reading Gmail's DOM, and the Node DOM the unit tests use
 * (happy-dom) cannot hold this page (about 0.5 MB of heap per row: a 10,000-row page exhausts the worker) and is far
 * slower than Chrome's DOM, so a Node number would measure happy-dom. Here a plain Chromium (no extension) opens the
 * page at Gmail's own address through routing (nothing reaches the network) in the fixtures' zone, and a test-only
 * bundle of the observer (./support/gmail-perf-entry.ts, built in memory, never shipped) runs in the page.
 *
 * The workload is the labelled Sent list (tests/fixtures/pages/gmail/2026-10-03/synthetic-sent-page-1.html) grown to
 * 10,000 rows: its first row repeated with a thread and message id of its own, one recipient of its own and a send
 * time one minute older than the row above. One timed run is the content script's work for one pass before its first
 * post: `planPass` (health → extract → redact.project → windows → account) and `passMessages` (every bus message,
 * each checked against its schema). Three runs, each on a freshly loaded page. Like the Node gates (tests/perf/measure.ts)
 * the gate is the median CPU time of the runs, the cold first run included: here the page's main-thread CPU time
 * (CDP Performance.getMetrics `ThreadTime`), which style recalculation and garbage collection count in and which a
 * busy machine does not inflate the way it inflates wall time. Every run's CPU and wall time is logged.
 *
 * A fast wrong answer must not pass: each run is OK, holds one observation per row with its own recipient, posts the
 * head window from the minute after the oldest row's to the pass instant (the page's Older control is enabled, so the
 * list may go on: QA-1, src/observers/gmail/extract.ts), and builds 1 health, 20 row and 1 coverage message.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Browser, type CDPSession, chromium, expect, type Page, test } from '@playwright/test';
import { build } from 'vite';

import { SCHEMA_LIMITS } from '../../src/core/schema';
import { GMAIL_PERF_GLOBAL } from './support/gmail-perf-marker';
import { EXTENSION_PATH } from './support/extension';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRY = path.join(ROOT, 'tests/e2e/support/gmail-perf-entry.ts');
const FIXTURE = path.join(ROOT, 'tests/fixtures/pages/gmail/2026-10-03/synthetic-sent-page-1.html');
const PAGE_URL = 'https://mail.google.com/mail/u/0/?fixture=qa-perf-10k#sent';
const ZONE = 'America/New_York';

const ROWS = 10_000;
const RUNS = 3;
const GATE_MS = 2_000;

/** The labelled first row's ids, address and time (U+202F before AM, the fixture's own spelling). */
const TEMPLATE_ID = '1a101ff21e04e756';
const TEMPLATE_ADDRESS = 'alex.rivera@example.com';
const TEMPLATE_TITLE = 'Sat, Oct 3, 2026, 9:41\u202FAM';
const NEWEST_MS = Date.parse('2026-10-03T09:41:00-04:00');
/** The pass instant: after the newest row, on the page's day (the label's readAt is 09:58). */
const OBSERVED_AT = '2026-10-03T09:58:00-04:00';

const TITLE = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Row `i` (0 = newest): the template with its own 16-hex id, its own recipient, one minute older per row. */
function rowHtml(template: string, i: number): string {
  const id = (0x1a101ff21e04e756n - BigInt(i)).toString(16).padStart(16, '0');
  return template
    .replaceAll(TEMPLATE_ID, id)
    .replaceAll(TEMPLATE_ADDRESS, `perf.recipient.${String(i)}@example.com`)
    .replaceAll(TEMPLATE_TITLE, TITLE.format(new Date(NEWEST_MS - i * 60_000)));
}

/** The labelled Sent page with its rows replaced by ROWS copies of its first row. */
function bigSentPage(): string {
  const html = readFileSync(FIXTURE, 'utf8');
  const open = html.indexOf('<tbody>') + '<tbody>'.length;
  const close = html.indexOf('</tbody>');
  const rows = html.slice(open, close);
  const template = rows.slice(rows.indexOf('<tr'), rows.indexOf('</tr>') + '</tr>'.length);
  if (!template.includes(TEMPLATE_ID) || !template.includes(TEMPLATE_TITLE)) {
    throw new Error('the Sent fixture changed: its first row is not the template this gate expects');
  }
  const body = Array.from({ length: ROWS }, (_, i) => rowHtml(template, i)).join('\n');
  return `${html.slice(0, open)}\n${body}\n${html.slice(close)}`;
}

/** Bundles the test-only entry into one classic script (IIFE), in memory. */
async function bundleEntry(): Promise<string> {
  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      lib: { entry: ENTRY, formats: ['iife'], name: 'AttestGmailPerf', fileName: () => 'perf.js' },
    },
  });
  for (const output of Array.isArray(result) ? result : [result]) {
    if (!('output' in output)) continue;
    for (const chunk of output.output) if (chunk.type === 'chunk') return chunk.code;
  }
  throw new Error('vite produced no bundle');
}

interface RunResult {
  /** Wall time of the pass, measured in the page. */
  readonly ms: number;
  readonly status: string;
  readonly observations: number;
  readonly recipients: number;
  /** The coverage windows the pass would post, as epoch ms. */
  readonly windows: readonly (readonly [number, number])[];
  readonly types: readonly string[];
}

/** One timed pass in the page (see the module comment). */
async function timedPass(page: Page): Promise<RunResult> {
  return page.evaluate(
    ({ global, observedAt }) => {
      const perf = Reflect.get(window, global) as {
        pass: (at: string) => {
          plan: {
            status: string;
            observations: { counterparty?: string }[];
            coverage?: { windowStart: string; windowEnd: string }[];
          };
          types: string[];
        };
      };
      const started = performance.now();
      const { plan, types } = perf.pass(observedAt);
      const ms = performance.now() - started;
      return {
        ms,
        status: plan.status,
        observations: plan.observations.length,
        recipients: new Set(plan.observations.map((row) => row.counterparty)).size,
        windows: (plan.coverage ?? []).map((window): [number, number] => [
          Date.parse(window.windowStart),
          Date.parse(window.windowEnd),
        ]),
        types,
      };
    },
    { global: GMAIL_PERF_GLOBAL, observedAt: OBSERVED_AT },
  );
}

/** The page's main-thread CPU time so far, in ms (CDP Performance.getMetrics `ThreadTime`, in seconds). */
async function threadMs(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const thread = metrics.find((metric) => metric.name === 'ThreadTime');
  if (thread === undefined) throw new Error('CDP reported no ThreadTime');
  return thread.value * 1_000;
}

/** Main-thread CPU below this per QUIET_STEP_MS means the page finished its own load work (layout, paint). */
const QUIET_CPU_MS = 5;
const QUIET_STEP_MS = 250;
const QUIET_STEPS = 40;

/** Waits until the page's main thread is idle, so the loaded page's own layout is not charged to the pass. */
async function settle(page: Page, cdp: CDPSession): Promise<void> {
  const deltas: number[] = [];
  for (let step = 0; step < QUIET_STEPS; step += 1) {
    const before = await threadMs(cdp);
    await page.waitForTimeout(QUIET_STEP_MS);
    const delta = (await threadMs(cdp)) - before;
    if (delta < QUIET_CPU_MS) return;
    deltas.push(Math.round(delta));
  }
  throw new Error(`the page never went quiet (main-thread CPU per step: ${deltas.join(', ')} ms)`);
}

/** One timed pass: its result, plus the page's main-thread CPU time it took. */
async function cpuTimedPass(page: Page): Promise<RunResult & { readonly cpuMs: number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
  await settle(page, cdp);
  const before = await threadMs(cdp);
  const result = await timedPass(page);
  const cpuMs = (await threadMs(cdp)) - before;
  await cdp.detach();
  return { ...result, cpuMs };
}

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

// A trace snapshots the DOM at every step; on a 10,000-row page that is the main thread's biggest job, and it would
// be charged to the pass. This test records no trace (its log has every run's numbers).
test.use({ trace: 'off' });

let browser: Browser;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true });
});

test.afterAll(async () => {
  await browser.close();
});

/** Opens the 10,000-row page at Gmail's address, then adds the observer bundle to it. */
async function openBigPage(html: string, code: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ timezoneId: ZONE });
  await context.route('**/*', (route) =>
    route.request().url().startsWith('https://mail.google.com/mail/u/0/')
      ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
      : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.addScriptTag({ content: code });
  return { page, close: () => context.close() };
}

test(
  'perf gate (task 2.2): one Gmail Sent pass over a 10,000-row Sent list takes a median < 2 s of CPU in Chromium, and is right',
  { tag: '@perf' },
  async () => {
    test.setTimeout(5 * 60_000);
    const html = bigSentPage();
    const code = await bundleEntry();
    const runs: (RunResult & { readonly cpuMs: number })[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const { page, close } = await openBigPage(html, code);
      try {
        runs.push(await cpuTimedPass(page));
      } finally {
        await close();
      }
    }
    const medianCpuMs = median(runs.map((run) => run.cpuMs));
    const each = runs.map(
      (run, i) => `run ${String(i + 1)} ${run.cpuMs.toFixed(1)} ms CPU / ${run.ms.toFixed(1)} ms wall`,
    );
    console.log(
      `perf gate: Gmail Sent pass over ${String(ROWS)} rows: median ${medianCpuMs.toFixed(1)} ms CPU (${each.join('; ')})`,
    );
    const rowMessages = Math.ceil(ROWS / SCHEMA_LIMITS.BATCH);
    for (const run of runs) {
      expect({ ...run, ms: 0, cpuMs: 0 }).toEqual({
        ms: 0,
        cpuMs: 0,
        status: 'OK',
        observations: ROWS,
        recipients: ROWS,
        // The head of the list, which may go on (Older is enabled): from the minute after the oldest row's to the pass
        // instant, since a send in the oldest row's own minute may be on the next page (docs/grading.md §3; QA-1).
        windows: [[NEWEST_MS - (ROWS - 1) * 60_000 + 60_000, Date.parse(OBSERVED_AT)]],
        types: [
          'adapter.health',
          ...Array<string>(rowMessages).fill('observer.observations'),
          'coverage.ping',
        ],
      });
    }
    expect(medianCpuMs).toBeLessThan(GATE_MS);
  },
);

/** Every file under `dir`. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

test('the test-only perf entry never ships', { tag: '@perf' }, () => {
  const shipped = filesUnder(EXTENSION_PATH).filter((file) =>
    readFileSync(file, 'utf8').includes(GMAIL_PERF_GLOBAL),
  );
  expect(shipped.map((file) => path.relative(EXTENSION_PATH, file))).toEqual([]);
});
