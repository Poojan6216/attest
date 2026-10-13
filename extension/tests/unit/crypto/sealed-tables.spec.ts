import 'fake-indexeddb/auto';
/**
 * Every sealed table round-trips (sprint_6 6.5 Done when: "round-trip tests"; Sprint 6 close, tech review TECH-5, QA-3),
 * the tables taken from SEALED_TABLES itself, so one added later is covered by construction: a row of each, its key
 * fields set as its schema reads them (a compound key for `calendarSnapshots`, whose additional data is then the JSON
 * of an array), is stored as its key, its index fields and `sealed`, with its content nowhere in the clear; reads back
 * equal; and does not open moved onto another row of its own table.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SEALED_TABLES } from '../../../src/config-crypto';
import { loadCipher } from '../../../src/crypto/cipher';
import { clearKeyring, setKeyring } from '../../../src/crypto/keyring';
import { isSealed } from '../../../src/crypto/sealed';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { expectLedgerError, uniqueDbName } from '../ledger/fixtures';
import { rawPut, rawRows, textsIn } from './raw-store';

const KEY = { id: 'aaaaaaaaaaaa', bytes: Uint8Array.from({ length: 32 }, (_, i) => i + 11) };
const CONTENT = 'invented content that must stay sealed';

let name: string;
let db: LedgerDb;

/** Row `n` of `table`: each field of its primary key set, and content outside them. */
function rowOf(table: string, n: number): Record<string, unknown> {
  const { keyPath } = db.table(table).schema.primKey;
  const row: Record<string, unknown> = {
    content: `${CONTENT} ${table} ${String(n)}`,
    amountCents: 4_200 + n,
  };
  for (const field of typeof keyPath === 'string' ? [keyPath] : (keyPath ?? []))
    row[field] = `${field}-${String(n)}`;
  return row;
}

const keyOf = (table: string, row: Record<string, unknown>): unknown => {
  const { keyPath } = db.table(table).schema.primKey;
  return Array.isArray(keyPath) ? keyPath.map((field) => row[field]) : row[String(keyPath)];
};

beforeAll(loadCipher);

beforeEach(async () => {
  name = uniqueDbName('sealed-tables');
  db = await openLedger(name);
  setKeyring({ sealing: true, guarded: true, current: KEY });
});

afterEach(() => {
  db.close();
  clearKeyring();
});

describe('every sealed table', () => {
  it.each([...SEALED_TABLES])(
    '%s: stored sealed, its content nowhere in the clear, and read back equal',
    async (table) => {
      const row = rowOf(table, 1);
      await db.table(table).put(row);
      const [stored] = await rawRows(name, table);
      expect(isSealed(stored?.sealed)).toBe(true);
      expect(textsIn(stored).join('\n')).not.toContain(CONTENT);
      expect(await db.table(table).get(keyOf(table, row) as never)).toEqual(row);
    },
  );

  it.each([...SEALED_TABLES])(
    '%s: a sealed value moved onto another row does not open there',
    async (table) => {
      await db.table(table).bulkPut([rowOf(table, 1), rowOf(table, 2)]);
      const [first, second] = await rawRows(name, table);
      if (first === undefined || second === undefined) throw new Error(`${table} did not store two rows`);
      await rawPut(name, table, { ...second, sealed: first.sealed });
      await expectLedgerError(db.table(table).get(keyOf(table, rowOf(table, 2)) as never), 'unreadable');
    },
  );
});
