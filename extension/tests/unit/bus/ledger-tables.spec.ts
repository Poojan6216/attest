/**
 * `ledger.changed` names ledger tables. The bus's `LedgerTable` enum duplicates the table list of the
 * ledger (sprint 0.6), so this test is what keeps them equal: a drift would let a change notice name a
 * table that does not exist, or make one that does exist unnameable.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { LedgerTable } from '../../../src/bus/messages';
import { STORES_V1, STORES_V2, STORES_V3, STORES_V6, STORES_V9, STORES_V10 } from '../../../src/ledger/db';
import { LEDGER_TABLE_NAMES, type LedgerTableName } from '../../../src/ledger/index-fields';

describe('LedgerTable parity with the ledger', () => {
  it('names exactly the ledger tables the Dexie schema creates (v1, the stores v2, v3, v6, v9 and v10 add; v5 holds replay records)', () => {
    const busTables = [...LedgerTable.options].sort();
    const created = new Set([
      ...Object.keys(STORES_V1),
      ...Object.keys(STORES_V2),
      ...Object.keys(STORES_V3),
      ...Object.keys(STORES_V6),
      ...Object.keys(STORES_V9),
      ...Object.keys(STORES_V10),
    ]);
    expect(busTables).toEqual([...created].sort());
    expect(busTables).toEqual([...LEDGER_TABLE_NAMES].sort());
  });

  it('is the same type as the ledger table name', () => {
    expectTypeOf<LedgerTable>().toEqualTypeOf<LedgerTableName>();
  });
});
