/**
 * Collectors for every channel the @mandatory no-leak test searches: the extension's own ledger export, a
 * raw dump of every IndexedDB database, every chrome.storage area, the extension origin's web storage and
 * CacheStorage, the web storage, IndexedDB and cookies of every page the extension can see, console output
 * from every context, and network URLs and bodies. Each collector fails loudly if it cannot read its
 * channel, so an unreadable channel can never pass as "no leaks".
 */
import type { BrowserContext, Cookie, Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { LEDGER_PLACE } from './ledger-place';

declare const chrome: WxtBrowser;

type IndexedDbDump = Readonly<Record<string, Readonly<Record<string, unknown[]>>>>;

export interface StorageChannels {
  /** The ui.result answer to { kind: 'ledger.export' }. */
  readonly ledgerExport: unknown;
  /** database name → object store name → every record. */
  readonly indexedDb: IndexedDbDump;
  /** chrome.storage local / session / sync, complete. */
  readonly storage: Readonly<Record<string, unknown>>;
  /** "<tab> <page URL>" → its localStorage and sessionStorage, for every open extension page. */
  readonly webStorage: Readonly<Record<string, unknown>>;
  /** cache name → every entry's URL and body, in the extension origin. */
  readonly cacheStorage: Readonly<Record<string, unknown>>;
}

export interface PageChannels {
  /** "<tab> <page URL>" → its localStorage, sessionStorage, IndexedDB and document.cookie. */
  readonly pageStorage: Readonly<Record<string, unknown>>;
  /** Every cookie in the browser profile. */
  readonly cookies: readonly Cookie[];
}

/**
 * Every IndexedDB database of the page's origin, store by store (runs in the page): the default store's by their
 * names, and each storage bucket's as `<bucket>:<name>` (the ledger's, src/ledger/place.ts, among them).
 */
function dumpIndexedDb(page: Page): Promise<IndexedDbDump> {
  return page.evaluate(async () => {
    const request = <T>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => {
          resolve(r.result);
        };
        r.onerror = () => {
          reject(new Error('indexeddb read failed'));
        };
      });
    const dump: Record<string, Record<string, unknown[]>> = {};
    const places: (readonly [prefix: string, factory: IDBFactory])[] = [['', indexedDB]];
    for (const bucket of await navigator.storageBuckets.keys()) {
      places.push([`${bucket}:`, (await navigator.storageBuckets.open(bucket)).indexedDB]);
    }
    for (const [prefix, factory] of places) {
      for (const info of await factory.databases()) {
        if (info.name === undefined) continue;
        const db = await request(factory.open(info.name));
        const stores: Record<string, unknown[]> = {};
        for (const name of Array.from(db.objectStoreNames)) {
          stores[name] = await request(db.transaction(name).objectStore(name).getAll());
        }
        db.close();
        dump[`${prefix}${info.name}`] = stores;
      }
    }
    return dump;
  });
}

function dumpWebStorage(
  page: Page,
): Promise<{ local: Record<string, string>; session: Record<string, string> }> {
  return page.evaluate(() => {
    const read = (store: Storage) => {
      const out: Record<string, string> = {};
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key !== null) out[key] = store.getItem(key) ?? '';
      }
      return out;
    };
    return { local: read(localStorage), session: read(sessionStorage) };
  });
}

function dumpCacheStorage(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const dump: Record<string, { url: string; body: string }[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      const entries: { url: string; body: string }[] = [];
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({ url: request.url, body: response ? await response.text() : '' });
      }
      dump[name] = entries;
    }
    return dump;
  });
}

const isExtensionPage = (page: Page): boolean => page.url().startsWith('chrome-extension://');
const isWebPage = (page: Page): boolean => /^https?:\/\//.test(page.url());

/** Collects the extension-origin channels; `extensionPage` must be an open page of the extension. */
export async function collectStorageChannels(
  extensionPage: Page,
  context: BrowserContext,
): Promise<StorageChannels> {
  const ledgerExport: unknown = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'ledger.export' } }),
  );
  const indexedDb = await dumpIndexedDb(extensionPage);
  const storage = await extensionPage.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
    sync: await chrome.storage.sync.get(null),
  }));
  // Keyed by tab as well as URL: two open options pages have separate sessionStorage.
  const webStorage: Record<string, unknown> = {};
  for (const [tab, page] of context.pages().filter(isExtensionPage).entries()) {
    webStorage[`${String(tab)} ${page.url()}`] = await dumpWebStorage(page);
  }
  const cacheStorage = await dumpCacheStorage(extensionPage);
  return { ledgerExport, indexedDb, storage, webStorage, cacheStorage };
}

/** Collects the storage of every open web page (where content scripts run) and every cookie. */
export async function collectPageChannels(context: BrowserContext): Promise<PageChannels> {
  const pageStorage: Record<string, unknown> = {};
  for (const [tab, page] of context.pages().filter(isWebPage).entries()) {
    pageStorage[`${String(tab)} ${page.url()}`] = {
      ...(await dumpWebStorage(page)),
      indexedDb: await dumpIndexedDb(page),
      cookie: await page.evaluate(() => document.cookie),
    };
  }
  return { pageStorage, cookies: await context.cookies() };
}

/**
 * Writes `{ key, value }` into the ledger's meta store from an extension page, behind the ledger's back (the
 * negative control's plant; a known row for restart tests). The ledger must already be open (export first).
 */
export async function plantIndexedDbProbe(
  extensionPage: Page,
  value: string | number,
  key = 'probe',
): Promise<void> {
  await extensionPage.evaluate(
    async ([k, v, place]) => {
      const named: unknown = (await chrome.storage.local.get(place.key))[place.key];
      const ledger = (await navigator.storageBuckets.open(typeof named === 'string' ? named : place.first))
        .indexedDB;
      return new Promise<void>((resolve, reject) => {
        const open = ledger.open(place.db);
        open.onsuccess = () => {
          const tx = open.result.transaction('meta', 'readwrite');
          tx.objectStore('meta').put({ key: k, value: v });
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
    },
    [key, value, LEDGER_PLACE] as const,
  );
}

/** Records console output from a page or worker into `sink`, prefixed with its source. */
export function recordConsole(source: Page | Worker, label: string, sink: string[]): void {
  source.on('console', (message) => {
    sink.push(`${label} ${message.type()} ${message.text()}`);
  });
}
