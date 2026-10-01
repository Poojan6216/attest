/**
 * `ledger.changed` names ledger tables. The bus's `LedgerTable` enum duplicates the table list of the
 * ledger (sprint 0.6), so this test is what keeps them equal: a drift would let a change notice name a
 * table that does not exist, or make one that does exist unnameable.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { LedgerTable } from '../../../src/bus/messages';
import { STORES_V1 } from '../../../src/ledger/db';
import { LEDGER_TABLE_NAMES, type LedgerTableName } from '../../../src/ledger/index-fields';

describe('LedgerTable parity with the ledger', () => {
  it('names exactly the tables the Dexie v1 schema creates', () => {
    const busTables = [...LedgerTable.options].sort();
    expect(busTables).toEqual(Object.keys(STORES_V1).sort());
    expect(busTables).toEqual([...LEDGER_TABLE_NAMES].sort());
  });

  it('is the same type as the ledger table name', () => {
    expectTypeOf<LedgerTable>().toEqualTypeOf<LedgerTableName>();
  });
});
