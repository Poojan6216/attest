/**
 * Collectors for every channel the @mandatory no-leak test searches: the extension's own ledger
 * export, a raw dump of every IndexedDB database, every chrome.storage area, console output from
 * every context, and network URLs and bodies. Each collector fails loudly if it cannot read its
 * channel, so an unreadable channel can never pass as "no leaks".
 */
import type { Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

declare const chrome: WxtBrowser;

export interface StorageChannels {
  /** The ui.result answer to { kind: 'ledger.export' }. */
  readonly ledgerExport: unknown;
  /** database name → object store name → every record. */
  readonly indexedDb: Readonly<Record<string, Readonly<Record<string, unknown[]>>>>;
  /** chrome.storage local / session / sync, complete. */
  readonly storage: Readonly<Record<string, unknown>>;
}

/** Collects the storage channels from inside an extension page (same origin as the ledger). */
export async function collectStorageChannels(extensionPage: Page): Promise<StorageChannels> {
  const ledgerExport: unknown = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'ledger.export' } }),
  );
  const indexedDb = await extensionPage.evaluate(async () => {
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
    for (const info of await indexedDB.databases()) {
      if (info.name === undefined) continue;
      const db = await request(indexedDB.open(info.name));
      const stores: Record<string, unknown[]> = {};
      for (const name of Array.from(db.objectStoreNames)) {
        stores[name] = await request(db.transaction(name).objectStore(name).getAll());
      }
      db.close();
      dump[info.name] = stores;
    }
    return dump;
  });
  const storage = await extensionPage.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    session: await chrome.storage.session.get(null),
    sync: await chrome.storage.sync.get(null),
  }));
  return { ledgerExport, indexedDb, storage };
}

/** Records console output from a page or worker into `sink`, prefixed with its source. */
export function recordConsole(source: Page | Worker, label: string, sink: string[]): void {
  source.on('console', (message) => {
    sink.push(`${label} ${message.type()} ${message.text()}`);
  });
}
