/**
 * The ledger's rows as IndexedDB holds them, read and written without Dexie, and so without the sealing middleware
 * (src/crypto/middleware.ts): what someone who copied the profile would see, and how a tampered row is made.
 * Import 'fake-indexeddb/auto' before this module.
 */
type RawRow = Record<string, unknown>;

function withStore<T>(
  name: string,
  store: string,
  mode: IDBTransactionMode,
  run: (objects: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name);
    opening.onerror = () => {
      reject(new Error(`raw open of ${name} failed`));
    };
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result as T);
      };
      tx.onabort = () => {
        db.close();
        reject(new Error(`raw ${mode} of ${store} failed`));
      };
    };
  });
}

/** Every row of `store`, as stored. */
export const rawRows = (name: string, store: string): Promise<RawRow[]> =>
  withStore(name, store, 'readonly', (objects) => objects.getAll());

/** Writes `row` into `store` as it is. */
export const rawPut = (name: string, store: string, row: RawRow): Promise<unknown> =>
  withStore(name, store, 'readwrite', (objects) => objects.put(row));

/** Every string in `value`, nested values included, and every byte array as Latin-1 text. */
export function textsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (value instanceof Uint8Array) return [Buffer.from(value).toString('latin1')];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(textsIn);
  return [];
}
