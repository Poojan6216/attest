/**
 * The secret-seed test with encryption at rest on (Sprint 6 close, security review SEC-4; Hard Rules 2 and 10), beside
 * the mandatory one (./no-leak.spec.ts) and with its channels. With an invented passphrase: two invented sends stored,
 * encryption turned on, the ledger locked and unlocked again from the popup. Then neither the passphrase nor the
 * ledger's key, as base64, read from the one place the key belongs (the session's slot for it), is in any channel:
 * the export, every IndexedDB database, chrome.storage (that slot out, and searched for the passphrase alone), the
 * extension's web and cache storage, the pages' storage and cookies, the console, the network as the route guard and
 * NetLog saw it; nor anywhere in the profile's files once the browser is closed, read without Chrome
 * (./support/profile-files.ts), the key never on disk. And the export holds no `crypto.` key and not the key check, so
 * it carries no way to test a guess of the passphrase.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { SESSION_KEYS } from '../../src/config';
import { startFixtureServer } from '../tools/serve-fixtures';
import { collectPageChannels, collectStorageChannels, recordConsole } from './support/channels';
import { LOCKED_TEXT, turnOnEncryption, unlockIn } from './support/encryption';
import { launchExtension, type LaunchedExtension } from './support/extension';
import { LEDGER_PLACE } from './support/ledger-place';
import { findLeaks, type Leak, type Seed } from './support/leaks';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import { guardArgs, installRouteGuard, type RouteRecord } from './support/network-guard';
import { MINUTE_MS, openSent } from './support/priya';
import { scanProfileFiles, scanProfileIndexedDb } from './support/profile-files';
import { FIXTURE_TIME_ZONE } from './support/vendor-pages';

declare const chrome: WxtBrowser;

/** Invented only. */
const PASSPHRASE = 'invented sealing passphrase Quokka 4471';
const seedOf = (id: string, value: string): Seed => ({ id, kind: 'secret', value, canaries: [] });
const PASSPHRASE_SEED = seedOf('ledger_passphrase', PASSPHRASE);

/** The ledger's key check, read from IndexedDB itself. */
const keyCheckAtRest = (page: Page): Promise<string> =>
  page.evaluate(async (place) => {
    const named: unknown = (await chrome.storage.local.get(place.key))[place.key];
    const ledger = (await navigator.storageBuckets.open(typeof named === 'string' ? named : place.first))
      .indexedDB;
    return new Promise<string>((resolve, reject) => {
      const open = ledger.open(place.db);
      open.onerror = () => {
        reject(new Error('the ledger did not open'));
      };
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('meta').objectStore('meta').get('crypto.check');
        read.onsuccess = () => {
          db.close();
          resolve(String(Reflect.get(Object(read.result), 'value')));
        };
      };
    });
  }, LEDGER_PLACE);

/** Two sends stored, encryption turned on, the ledger locked and unlocked again from the popup. */
async function sealAndUnlockAgain(extension: LaunchedExtension, routes: Map<string, string>, options: Page) {
  const nowMs = Date.now();
  await openSent(extension, routes, options, nowMs, nowMs - 20 * MINUTE_MS);
  await turnOnEncryption(options, PASSPHRASE);
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'crypto.lock' }));
  const popup = await extension.openExtensionPage('popup.html');
  await expect(popup.getByText(LOCKED_TEXT)).toBeVisible();
  await unlockIn(popup, PASSPHRASE);
  await expect(popup.getByText(LOCKED_TEXT)).toHaveCount(0);
}

/** Every channel's leaks of the passphrase and the key, which the session's slot for the keys alone may hold. */
async function channelLeaks(
  extension: LaunchedExtension,
  options: Page,
  heard: { readonly consoleLines: readonly string[]; readonly routeRecords: readonly RouteRecord[] },
): Promise<{ readonly key: string; readonly leaks: Leak[]; readonly exported: string }> {
  const storage = await collectStorageChannels(options, extension.context);
  const { [SESSION_KEYS.LEDGER_KEYS]: slot, ...session } = Object(storage.storage.session) as Record<
    string,
    unknown
  >;
  const key: unknown = Reflect.get(Object(Reflect.get(Object(slot), 'current')), 'key');
  if (typeof key !== 'string') throw new Error('no key is held for the pages');
  const seeds = [PASSPHRASE_SEED, seedOf('ledger_key', key)];
  const pages = await collectPageChannels(extension.context);
  const network = heard.routeRecords.map((r) => `${r.url} ${r.body} ${r.headers}`);
  const leaks = [
    ...findLeaks('ledger-export', storage.ledgerExport, seeds),
    ...findLeaks('indexeddb', storage.indexedDb, seeds),
    ...findLeaks('chrome-storage', { ...storage.storage, session }, seeds),
    ...findLeaks('chrome-storage-key-slot', slot, [PASSPHRASE_SEED]),
    ...findLeaks('web-storage', storage.webStorage, seeds),
    ...findLeaks('cache-storage', storage.cacheStorage, seeds),
    ...findLeaks('page-storage', pages.pageStorage, seeds),
    ...findLeaks('cookies', pages.cookies, seeds),
    ...findLeaks('console', heard.consoleLines, seeds),
    ...findLeaks('network', network, seeds),
  ];
  return { key, leaks, exported: JSON.stringify(storage.ledgerExport) };
}

test('encryption on: no passphrase or key in any channel or on disk, and no verifier in the export', async () => {
  test.setTimeout(240_000);
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-noleak-sealed-'));
  const routes = new Map<string, string>();
  const consoleLines: string[] = [];
  const extension = await launchExtension({
    extraArgs: (attempt) => guardArgs(netLogPathFor(dir, attempt)),
    timezoneId: FIXTURE_TIME_ZONE,
  });
  try {
    const routeRecords = await installRouteGuard(extension.context, {
      fixtureOrigin: server.origin,
      routedFixtures: routes,
    });
    recordConsole(await extension.serviceWorker(), 'service-worker', consoleLines);
    extension.context.on('page', (page) => {
      recordConsole(page, page.url() || 'page', consoleLines);
    });
    const options = await extension.openExtensionPage('options.html');
    await sealAndUnlockAgain(extension, routes, options);
    const { key, leaks, exported } = await channelLeaks(extension, options, { consoleLines, routeRecords });
    expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/u);
    expect(exported).not.toContain('crypto.');
    expect(exported).not.toContain(await keyCheckAtRest(options));
    await extension.context.close();
    const seeds = [PASSPHRASE_SEED, seedOf('ledger_key', key)];
    const netLog = readNetLogRequests(dir).map((request) => request.url);
    expect([...leaks, ...findLeaks('network', netLog, seeds)]).toEqual([]);
    // On disk: nowhere in the profile, its LevelDB stores decoded.
    expect(scanProfileIndexedDb(extension.userDataDir, [PASSPHRASE, key])).toMatchObject({
      found: [],
      unparsed: [],
    });
    expect(scanProfileFiles(extension.userDataDir, [PASSPHRASE, key]).found).toEqual([]);
  } finally {
    await extension.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
