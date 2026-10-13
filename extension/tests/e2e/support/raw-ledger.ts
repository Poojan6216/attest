/**
 * Rows written into the extension's own ledger as they are stored, below Dexie and its sealing middleware (Sprint 6
 * close, tech review TECH-14: one writer where three were): a test's away spans, the 30-day ledger. `target` is an
 * extension page or the service worker. Only the extension's own code creates the ledger, with every store, so this
 * refuses one that does not exist yet.
 */
/** What an extension page and the service worker both offer: running a function there, with one argument. */
interface Evaluates {
  evaluate<R, Arg>(run: (arg: Arg) => R | Promise<R>, arg: Arg): Promise<R>;
}

/** Writes `rows` into `store`, in one transaction. */
export async function putRawRows(target: Evaluates, store: string, rows: readonly unknown[]): Promise<void> {
  // No named function inside: `pnpm bench` runs the e2e helpers under tsx (see ./perf-ledger.ts).
  const write = ({ name, chunk }: { readonly name: string; readonly chunk: readonly unknown[] }) =>
    new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('attest');
      open.onerror = () => {
        reject(new Error('the ledger did not open'));
      };
      open.onupgradeneeded = () => {
        open.transaction?.abort();
        reject(new Error('the ledger does not exist yet'));
      };
      open.onsuccess = () => {
        const tx = open.result.transaction(name, 'readwrite');
        for (const row of chunk) tx.objectStore(name).put(row);
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onabort = () => {
          open.result.close();
          reject(new Error(`the ${name} rows were not stored`));
        };
      };
    });
  const arg = { name: store, chunk: [...rows] };
  await target.evaluate(write, arg);
}
