/**
 * Chrome's storage buckets (Chrome 122 and later), which TypeScript's DOM types do not have: what the tests use of them,
 * in an extension page or the service worker (tests/e2e) and in the unit run's fake (tests/unit/storage-buckets-setup.ts).
 * src/ledger/place.ts checks for them itself and never reads these.
 */
interface StorageBucket {
  readonly indexedDB: IDBFactory;
}

interface StorageBucketManager {
  open(name: string): Promise<StorageBucket>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<void>;
}

interface Navigator {
  readonly storageBuckets: StorageBucketManager;
}

interface WorkerNavigator {
  readonly storageBuckets: StorageBucketManager;
}
