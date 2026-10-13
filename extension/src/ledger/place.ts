/**
 * Where the ledger's database lives (Sprint 6 close, security review SEC-1): a storage bucket of its own
 * (`navigator.storageBuckets`, Chrome 122 and later), named LEDGER_BUCKET_PREFIX and a generation, never the
 * extension's default store. Chrome keeps each bucket's IndexedDB in a folder of its own and deletes the folder with
 * the bucket. So a rebuild (./rebuild.ts) removes every older copy of a row from Chrome's files by copying the rows
 * into the next bucket and deleting the one that held them, which nothing written meanwhile can undo. Deleting a
 * database in a store it shares does not: Chrome compacts the deleted rows away on a thread of its own after the
 * deletion has answered, and a write landing at that moment leaves them in its files (measured 2026-10-13, Decisions
 * [6.close]).
 *
 * `chrome.storage.local` names the bucket in use (STORAGE_KEYS.LEDGER_BUCKET). With none named (a first start, or after
 * Delete all data), the newest ledger bucket there is, or the first, is named. Only the service worker writes the
 * ledger, deletes a bucket or names the next one; a page names one only when none is.
 */
import { browser } from 'wxt/browser';
import { z } from 'zod';

import { STORAGE_KEYS } from '../config';
import { LEDGER_BUCKET_PREFIX } from '../config-crypto';
import { log } from '../log';
import { LedgerError } from './errors';

/** Chrome's storage buckets, as Attest uses them (TypeScript's DOM types do not have them). */
interface StorageBuckets {
  open(name: string): Promise<{ readonly indexedDB: IDBFactory }>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<void>;
}

const BUCKET = new RegExp(`^${LEDGER_BUCKET_PREFIX}([1-9][0-9]{0,8})$`, 'u');
const BucketName = z.string().regex(BUCKET);

/** The first ledger bucket: a new install's, and the one named after Delete all data. */
export const FIRST_LEDGER_BUCKET = `${LEDGER_BUCKET_PREFIX}1`;

function isStorageBuckets(value: unknown): value is StorageBuckets {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['open', 'keys', 'delete'].every((method) => typeof Reflect.get(value, method) === 'function')
  );
}

/** This context's storage buckets; none is an error, never a fallback to the default store (Hard Rule 6). */
function storageBuckets(): StorageBuckets {
  const buckets: unknown = Reflect.get(globalThis.navigator, 'storageBuckets');
  if (!isStorageBuckets(buckets)) {
    throw new LedgerError('open_failed', 'This browser gives no storage buckets', {});
  }
  return buckets;
}

const generation = (name: string): number => Number(BUCKET.exec(name)?.[1] ?? 0);

/** The ledger bucket after `name`. */
export const nextLedgerBucket = (name: string): string =>
  `${LEDGER_BUCKET_PREFIX}${String(generation(name) + 1)}`;

/** Every ledger bucket there is, oldest first. */
export async function ledgerBuckets(): Promise<string[]> {
  const names = await storageBuckets().keys();
  return names.filter((name) => BUCKET.test(name)).sort((a, b) => generation(a) - generation(b));
}

/** Names `name` the bucket the ledger is in. */
export async function nameLedgerBucket(name: string): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.LEDGER_BUCKET]: BucketName.parse(name) });
}

/** The bucket the ledger is in (header): the one named; with none named, the newest there is, or the first, named now. */
export async function ledgerBucket(): Promise<string> {
  const held = await browser.storage.local.get(STORAGE_KEYS.LEDGER_BUCKET);
  const named: unknown = held[STORAGE_KEYS.LEDGER_BUCKET];
  const parsed = BucketName.safeParse(named);
  if (parsed.success) return parsed.data;
  if (named !== undefined) log.warn('ledger.bucket_name_invalid');
  const chosen = (await ledgerBuckets()).at(-1) ?? FIRST_LEDGER_BUCKET;
  await nameLedgerBucket(chosen);
  return chosen;
}

/** The IndexedDB of bucket `name`, which Chrome makes if it is not there. */
export async function bucketIndexedDb(name: string): Promise<IDBFactory> {
  return (await storageBuckets().open(BucketName.parse(name))).indexedDB;
}

/** Deletes bucket `name`, if it is there, and with it the folder of Chrome's files that holds its databases. */
export async function deleteLedgerBucket(name: string): Promise<void> {
  await storageBuckets().delete(BucketName.parse(name));
}
