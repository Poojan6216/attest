/**
 * Measuring the built extension over the 30-day ledger (sprint_6 6.4; ../../perf/month-ledger.ts): its stored rows
 * written into the extension's own IndexedDB, the origin's storage as Chrome counts it, an export's time and the page's
 * peak heap while it ran, and the service worker's heap once idle, read over the DevTools protocol. Chrome is started
 * with `--enable-precise-memory-info`, so a page's heap figure is exact rather than bucketed, and a DevTools port of
 * its choosing (`PERF_ARGS`), written to the profile's `DevToolsActivePort`; Node talks to it on 127.0.0.1 only.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import type { LaunchedExtension } from './extension';

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * The month's stored rows, built by ../../perf/month-ledger.ts in a tsx process of its own: core reads the policy file
 * through a JSON import, which Playwright's loader does not take.
 */
export function buildMonthRows(endMs: number): Record<string, unknown[]> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-month-'));
  try {
    const out = path.join(dir, 'month.json');
    const script = path.join(EXTENSION_DIR, 'tests/perf/month-ledger-file.ts');
    execFileSync('pnpm', ['exec', 'tsx', script, out, String(endMs)], {
      cwd: EXTENSION_DIR,
      stdio: 'ignore',
    });
    const rows: unknown = JSON.parse(readFileSync(out, 'utf8'));
    if (typeof rows !== 'object' || rows === null) throw new Error('the month ledger file is not an object');
    return Object.fromEntries(
      Object.entries(rows).map(([name, list]) => [name, Array.isArray(list) ? list : []]),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const PERF_ARGS = ['--enable-precise-memory-info', '--remote-debugging-port=0'] as const;
/** Rows written per transaction. */
const CHUNK = 2_000;

/** Writes `rows` into the ledger's `store`, which the extension's own code created. */
async function putRows(page: Page, store: string, rows: readonly unknown[]): Promise<void> {
  await page.evaluate(
    ({ name, chunk }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('attest');
        open.onerror = () => {
          reject(new Error('the ledger did not open'));
        };
        // Never create the ledger here: only the extension's own code creates it, with every store.
        open.onupgradeneeded = () => {
          open.transaction?.abort();
          reject(new Error('the ledger does not exist yet'));
        };
        open.onsuccess = () => {
          const tx = open.result.transaction(name, 'readwrite');
          for (const row of chunk) tx.objectStore(name).put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onabort = () => {
            open.result.close();
            reject(new Error(`the ${name} were not stored`));
          };
        };
      }),
    { name: store, chunk: rows },
  );
}

/** Writes every table of `rows` into the extension's ledger, after its popup has opened (and so created) it. */
export async function seedLedger(
  extension: LaunchedExtension,
  rows: Readonly<Record<string, unknown[]>>,
): Promise<void> {
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${extension.extensionId}/popup.html`);
  await page.getByRole('status').first().waitFor();
  for (const [store, list] of Object.entries(rows)) {
    for (let at = 0; at < list.length; at += CHUNK) await putRows(page, store, list.slice(at, at + CHUNK));
  }
  await page.close();
}

/** The extension origin's storage as Chrome counts it (`navigator.storage.estimate`), in bytes. */
export async function storageBytes(extension: LaunchedExtension): Promise<number> {
  const page = await extension.openExtensionPage('options.html');
  const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? -1);
  await page.close();
  return usage;
}

export interface ExportRun {
  readonly ms: number;
  readonly bytes: number;
  /** The options page's JS heap at its highest while the export ran, above where it started. */
  readonly peakHeapBytes: number;
}

/** Clicks `button` on the options page and times the file it saves, sampling the page's heap all the while. */
export async function timeExport(extension: LaunchedExtension, button: string): Promise<ExportRun> {
  const page = await extension.openExtensionPage('options.html');
  await page.getByRole('button', { name: button }).waitFor();
  // No named function inside: the evaluated code runs in the page, where a bundler's name helper does not exist.
  await page.evaluate(() => {
    const used = Number(Reflect.get(Reflect.get(performance, 'memory') ?? {}, 'usedJSHeapSize') ?? 0);
    const state = { start: used, peak: used };
    Reflect.set(window, '__attestHeap', state);
    setInterval(() => {
      state.peak = Math.max(
        state.peak,
        Number(Reflect.get(Reflect.get(performance, 'memory') ?? {}, 'usedJSHeapSize') ?? 0),
      );
    }, 10);
  });
  const started = Date.now();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await downloaded;
  const ms = Date.now() - started;
  const bytes = (await readFile(await file.path())).length;
  const heap = await page.evaluate((): unknown => Reflect.get(window, '__attestHeap'));
  await page.close();
  const start = Number(Reflect.get(heap ?? {}, 'start'));
  const peak = Number(Reflect.get(heap ?? {}, 'peak'));
  return { ms, bytes, peakHeapBytes: Math.max(0, peak - start) };
}

/** One DevTools protocol call on `wsUrl`'s target, answered or failed within ten seconds. */
async function devtools(wsUrl: string, method: string): Promise<unknown> {
  const socket = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`devtools: no answer to ${method}`));
    }, 10_000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method }));
    });
    socket.addEventListener('message', (event) => {
      const answer: unknown = JSON.parse(String(event.data));
      if (Reflect.get(answer ?? {}, 'id') !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(Reflect.get(answer ?? {}, 'result'));
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`devtools: ${method} failed`));
    });
  });
}

/** The service worker's used JS heap after a garbage collection, in bytes: what it holds idle. */
export async function serviceWorkerHeapBytes(extension: LaunchedExtension): Promise<number> {
  const [port] = (await readFile(path.join(extension.userDataDir, 'DevToolsActivePort'), 'utf8')).split('\n');
  const targets = (await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()) as unknown;
  const list: readonly unknown[] = Array.isArray(targets) ? targets : [];
  const worker = list.find(
    (target: unknown) =>
      Reflect.get(target ?? {}, 'type') === 'service_worker' &&
      String(Reflect.get(target ?? {}, 'url')).startsWith(`chrome-extension://${extension.extensionId}/`),
  );
  const wsUrl = String(Reflect.get(worker ?? {}, 'webSocketDebuggerUrl'));
  if (!wsUrl.startsWith('ws://127.0.0.1')) throw new Error('devtools: no service worker target');
  await devtools(wsUrl, 'HeapProfiler.collectGarbage');
  const usage = await devtools(wsUrl, 'Runtime.getHeapUsage');
  return Number(Reflect.get(usage ?? {}, 'usedSize'));
}
