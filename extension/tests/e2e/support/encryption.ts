/**
 * Driving encryption at rest in the built extension (sprint_6 6.5): turning it on in the options page, unlocking from
 * any page's prompt, stopping the service worker as Chrome stops an idle one, and reading the ledger's rows straight
 * from IndexedDB, as someone who copied the profile would, without Dexie and so without the sealing middleware. The
 * raw read runs in an extension page and answers counts and which of the given values it found, never the rows.
 */
import { expect, type Page } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { SEALED_TABLES } from '../../../src/config-crypto';
import type { LaunchedExtension } from './extension';

declare const chrome: WxtBrowser;

/** The tables whose rows are sealed, from the code itself, passed to the page (tech review TECH-13). */
const SEALED = [...SEALED_TABLES];

export interface AtRest {
  /** Rows of the sealed tables stored sealed, and stored plain. */
  readonly sealed: number;
  readonly plain: number;
  /** The key ids the sealed rows carry. */
  readonly keyIds: readonly string[];
  /** Which of the values looked for appear anywhere in those rows, as text or as bytes. */
  readonly found: readonly string[];
}

/** The ledger at rest (header): `page` must be an open extension page. */
export async function ledgerAtRest(page: Page, lookFor: readonly string[]): Promise<AtRest> {
  // No named function inside: `pnpm bench` runs the e2e helpers under tsx (see ./perf-ledger.ts).
  return page.evaluate(
    async ({ stores, values }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('attest');
        open.onsuccess = () => {
          resolve(open.result);
        };
        open.onerror = () => {
          reject(new Error('the ledger did not open'));
        };
      });
      const texts: string[] = [];
      const keyIds = new Set<string>();
      let sealed = 0;
      let plain = 0;
      const walk = (value: unknown): void => {
        if (typeof value === 'string') texts.push(value);
        else if (value instanceof Uint8Array)
          texts.push(Array.from(value, (byte) => String.fromCharCode(byte)).join(''));
        else if (Array.isArray(value)) value.forEach(walk);
        else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
      };
      for (const store of stores.filter((name) => db.objectStoreNames.contains(name))) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const all = db.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => {
            resolve(all.result);
          };
          all.onerror = () => {
            reject(new Error('a store did not read'));
          };
        });
        for (const row of rows) {
          const box: unknown = Reflect.get(row ?? {}, 'sealed');
          const id: unknown = Reflect.get(box ?? {}, 'k');
          if (typeof id === 'string') {
            sealed += 1;
            keyIds.add(id);
          } else plain += 1;
          walk(row);
        }
      }
      db.close();
      const all = texts.join('\n');
      return { sealed, plain, keyIds: [...keyIds], found: values.filter((value) => all.includes(value)) };
    },
    { stores: SEALED, values: [...lookFor] },
  );
}

/** The keys of the encryption state in the ledger's `meta`, read straight from IndexedDB (the export leaves them out). */
export async function cryptoKeysAtRest(page: Page): Promise<string[]> {
  // No named function inside: `pnpm bench` runs the e2e helpers under tsx (see ./perf-ledger.ts).
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('attest');
        open.onerror = () => {
          reject(new Error('the ledger did not open'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const keys = db.transaction('meta').objectStore('meta').getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result.map(String).filter((key) => key.startsWith('crypto.')));
          };
          keys.onerror = () => {
            db.close();
            reject(new Error('meta did not read'));
          };
        };
      }),
  );
}

/** Turns encryption on from the options page's Encryption, and waits until every row is sealed. */
export async function turnOnEncryption(options: Page, passphrase: string): Promise<void> {
  const section = options.locator('#encryption');
  await section.getByLabel('New passphrase').fill(passphrase);
  await section.getByLabel('Type it again').fill(passphrase);
  await section.getByLabel(/I understand/u).check();
  await section.getByRole('button', { name: 'Turn on encryption' }).click();
  await expect(section.getByText('Your records are sealed, and unlocked in this browser now.')).toBeVisible({
    timeout: 60_000,
  });
}

/** Types `passphrase` into the unlock prompt `page` shows, and presses Unlock. */
export async function unlockIn(page: Page, passphrase: string): Promise<void> {
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

/** Stops every service worker of the profile, as Chrome stops an idle one, and waits until the extension's has. */
export async function stopServiceWorker(extension: LaunchedExtension, page: Page): Promise<void> {
  const cdp = await extension.context.newCDPSession(page);
  const statuses: string[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
    for (const version of versions) {
      if (version.scriptURL.startsWith(`chrome-extension://${extension.extensionId}/`)) {
        statuses.push(version.runningStatus);
      }
    }
  });
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await expect.poll(() => statuses.at(-1)).toBe('stopped');
  await cdp.detach();
}

/** What the popup says while the ledger is locked. */
export const LOCKED_TEXT = 'Your records are encrypted and locked';

/**
 * Wakes the service worker with a question that reads no sealed table (`health.list`), and waits for its answer: a
 * worker that was stopped starts again, and clears the pages' copy of the keys at its start.
 */
export async function wakeServiceWorker(page: Page): Promise<void> {
  const answer: unknown = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'health.list' } }),
  );
  expect(answer).toMatchObject({ ok: true });
}
