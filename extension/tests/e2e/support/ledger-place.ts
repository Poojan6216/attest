/**
 * Where the built extension's ledger is (Sprint 6 close, security review SEC-1; src/ledger/place.ts): the storage bucket
 * `chrome.storage.local` names, the first when none is named yet, never the default store. A test that reads or writes
 * the ledger's rows itself, in an extension page or the service worker, opens it there. `evaluate` cannot import, so
 * each passes LEDGER_PLACE in and looks the bucket up in the page with these lines:
 *
 *   const named: unknown = (await chrome.storage.local.get(place.key))[place.key];
 *   const ledger = (await navigator.storageBuckets.open(typeof named === 'string' ? named : place.first)).indexedDB;
 */
import { DB_NAME, STORAGE_KEYS } from '../../../src/config';
import { LEDGER_BUCKET_PREFIX } from '../../../src/config-crypto';

export const LEDGER_PLACE = {
  key: STORAGE_KEYS.LEDGER_BUCKET,
  first: `${LEDGER_BUCKET_PREFIX}1`,
  db: DB_NAME,
} as const;

export type LedgerPlace = typeof LEDGER_PLACE;
