/**
 * The secret-seed test's negative control (tests/e2e/no-leak.spec.ts, @mandatory): the plants it makes into a page the
 * extension reads, the console, the network and the share, each a known seed the collectors must catch. Moved out of the
 * spec unchanged (sprint_4 close: the spec reached its 400-line limit when the receipt's share became a channel).
 */
import type { Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { BYO_VENDORS } from '../../../src/config';
import { LEDGER_PLACE } from './ledger-place';
import { loadSeeds, type Seed } from './leaks';

declare const chrome: WxtBrowser;

const SEEDS = loadSeeds();

const seed = (id: string): Seed => {
  const found = SEEDS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`seed ${id} missing from seeded.json`);
  return found;
};

/** The negative control's plants into a page the extension reads: its web storage, IndexedDB and cookie. */
export async function plantInPage(page: Page): Promise<void> {
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
export async function plantInConsole(worker: Worker): Promise<void> {
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
 * percent-encoded character by character, an SSN in a body. They go to a host the extension's content security policy
 * lets it reach (a model vendor's, wxt.config.ts `connectSources`), since Chrome refuses any other before a request is
 * made (Sprint 5 close, SEC-3).
 */
export async function plantInNetwork(page: Page): Promise<void> {
  await page.evaluate(
    ([host, token, name, ssn]) => {
      const encoded = Array.from(name, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
      return Promise.all([
        fetch(`https://${host}/attest-canary?q=${token}`).catch(() => undefined),
        fetch(`https://${host}/attest-canary?n=${encoded}`).catch(() => undefined),
        fetch(`https://${host}/attest-canary`, { method: 'POST', body: ssn }).catch(() => undefined),
      ]);
    },
    [
      new URL(BYO_VENDORS.openai.endpoint).host,
      seed('url_with_token').value,
      seed('person_name_2').value,
      seed('ssn_shape').value,
    ] as const,
  );
}

/**
 * The negative control's plant into the share: a digest whose notable receipt's hint is a seed, stored behind the
 * ledger's back, so the share the digest page makes holds it, markdown-escaped (the seed has a hyphen).
 */
export async function plantInDigest(page: Page): Promise<void> {
  const digest = {
    week: '2026-10-05',
    from: '2026-10-05T00:00:00.000-04:00',
    to: '2026-10-12T00:00:00.000-04:00',
    createdAt: '2026-10-12T09:00:00.000-04:00',
    agents: [],
    notable: [
      {
        receiptId: '01JA0000000000000000000001',
        agent: 'muse',
        grade: 'NOT_FOUND',
        subjectHint: seed('person_name_2').value,
      },
    ],
    notableCount: 1,
    gaps: [],
    health: [],
  };
  await page.evaluate(
    async ({ row, place }) => {
      const named: unknown = (await chrome.storage.local.get(place.key))[place.key];
      const ledger = (await navigator.storageBuckets.open(typeof named === 'string' ? named : place.first))
        .indexedDB;
      return new Promise<void>((resolve, reject) => {
        const open = ledger.open(place.db);
        open.onsuccess = () => {
          const tx = open.result.transaction('digests', 'readwrite');
          tx.objectStore('digests').put(row);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error('the digest was not planted'));
          };
        };
        open.onerror = () => {
          reject(new Error('the ledger did not open'));
        };
      });
    },
    { row: digest, place: LEDGER_PLACE },
  );
}
