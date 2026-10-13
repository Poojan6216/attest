/**
 * Chrome's storage buckets (`navigator.storageBuckets`, Chrome 122 and later), which Node lacks: a setup file of the
 * main run (vitest.config.ts) gives each test file a fake in which every bucket is an IndexedDB of its own
 * (fake-indexeddb's IDBFactory), so the ledger (src/ledger/place.ts) opens, copies and deletes buckets as in Chrome.
 * Deleting a bucket deletes its databases, which closes their connections, and forgets it: one opened again is new.
 * Like the default store fake-indexeddb gives, the buckets last for the whole test file.
 */
import { IDBFactory } from 'fake-indexeddb';

const buckets = new Map<string, IDBFactory>();

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error ?? new Error(`the fake bucket's ${name} was not deleted`));
    };
  });
}

/** The fake (header); a test that needs a bucket as Chrome holds it reads it here. */
export const fakeStorageBuckets: StorageBucketManager = {
  open(name) {
    const factory = buckets.get(name) ?? new IDBFactory();
    buckets.set(name, factory);
    return Promise.resolve({ indexedDB: factory });
  },
  keys() {
    return Promise.resolve([...buckets.keys()]);
  },
  async delete(name) {
    const factory = buckets.get(name);
    buckets.delete(name);
    if (factory === undefined) return;
    for (const { name: database } of await factory.databases()) {
      if (database !== undefined) await deleteDatabase(factory, database);
    }
  },
};

Object.defineProperty(globalThis.navigator, 'storageBuckets', {
  value: fakeStorageBuckets,
  configurable: true,
});
