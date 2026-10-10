/**
 * The sealing middleware's cursor (src/crypto/middleware.ts `openingCursor`), over a cursor that, like a browser's
 * IDBCursor, reads `key`, `primaryKey` and `value` through getters that refuse any object but itself. fake-indexeddb's
 * cursor does not refuse, so without this a wrapper that left one of the three to its prototype passed every unit test
 * and failed in Chrome: Dexie reads `cursor.key` to walk an `anyOf` (the side panel's undo of a mark, sprint_6 6.5 e2e).
 */
import type { DBCore, DBCoreCursor, DBCoreIndex, DBCoreTable, DBCoreTransaction } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { clearKeyring } from '../../../src/crypto/keyring';
import { sealingMiddleware } from '../../../src/crypto/middleware';

const unused = () => Promise.reject(new Error('not used here'));

/** A cursor whose `key`, `primaryKey` and `value` refuse any receiver but itself, as a browser's does. */
class StrictCursor implements DBCoreCursor {
  readonly #key: string;
  readonly #primaryKey: string;
  readonly #value: unknown;
  readonly trans = {} as DBCoreTransaction;
  readonly done = false;
  constructor(key: string, primaryKey: string, value: unknown) {
    this.#key = key;
    this.#primaryKey = primaryKey;
    this.#value = value;
  }
  get key(): string {
    return this.#key;
  }
  get primaryKey(): string {
    return this.#primaryKey;
  }
  get value(): unknown {
    return this.#value;
  }
  continue(): void {
    return undefined;
  }
  continuePrimaryKey(): void {
    return undefined;
  }
  advance(): void {
    return undefined;
  }
  start(): Promise<unknown> {
    return Promise.resolve();
  }
  stop(): void {
    return undefined;
  }
  next(): Promise<DBCoreCursor> {
    return Promise.resolve(this);
  }
  fail(): void {
    return undefined;
  }
}

const PRIMARY: DBCoreIndex = {
  name: '',
  isPrimaryKey: true,
  outbound: false,
  keyPath: 'id',
  extractKey: (row: { id: string }) => row.id,
};

/** The layer below the middleware: one table, `claims`, whose every cursor is `cursor`. */
function below(cursor: DBCoreCursor): DBCore {
  const table: DBCoreTable = {
    name: 'claims',
    schema: { name: 'claims', primaryKey: PRIMARY, indexes: [], getIndexByKeyPath: () => undefined },
    mutate: unused,
    get: unused,
    getMany: unused,
    query: unused,
    count: unused,
    openCursor: () => Promise.resolve(cursor),
  };
  return {
    stack: 'dbcore',
    schema: { name: 'test', tables: [table.schema] },
    MIN_KEY: -Infinity,
    MAX_KEY: [[]],
    transaction: () => ({}) as DBCoreTransaction,
    table: () => table,
  };
}

afterEach(() => {
  clearKeyring();
});

describe("the sealing middleware's cursor", () => {
  it('reads key, primaryKey and value from the cursor itself, never through its prototype', async () => {
    const strict = new StrictCursor('index-key', 'row-id', { id: 'row-id', subjectHint: 'Invented' });
    // The stand-in refuses a receiver that is not itself, as Chrome's IDBCursor does.
    const leaned: DBCoreCursor = Object.create(strict) as DBCoreCursor;
    expect(() => {
      Reflect.get(leaned, 'key');
    }).toThrow(TypeError);
    const middleware = sealingMiddleware({
      derivedFields: () => [],
      locked: () => new Error('locked'),
      unreadable: () => new Error('unreadable'),
    });
    const table = middleware.create(below(strict)).table?.('claims');
    if (table === undefined) throw new Error('the middleware gave no table');
    // The layer below ignores the request, read here from text: its range type is a const enum, absent at runtime.
    const request = JSON.parse('{"values":true,"query":{"range":{"type":3}}}') as Parameters<
      DBCoreTable['openCursor']
    >[0];
    const cursor = await table.openCursor(request);
    const read = (field: string): unknown => Reflect.get(Object(cursor), field);
    expect(read('key')).toBe('index-key');
    expect(read('primaryKey')).toBe('row-id');
    expect(read('value')).toEqual({ id: 'row-id', subjectHint: 'Invented' });
  });
});
