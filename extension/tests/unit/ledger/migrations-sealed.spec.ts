import 'fake-indexeddb/auto';
/**
 * A schema upgrade on an encrypted ledger (src/ledger/migrations.ts `lockedIfSealing`; Sprint 6 close, security review
 * SEC-7, tech review TECH-10): the ledger opens before its keyring is loaded, so an upgrade that wrote a row of a sealed
 * table would store it in the clear, and no job would seal it. A schema version past the shipped ones that writes a
 * grant without reading one: on an encrypted ledger the upgrade fails, the ledger does not open, and no plain row is
 * stored; on a ledger without encryption it opens, the row written.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearKeyring } from '../../../src/crypto/keyring';
import { CRYPTO_KEYS } from '../../../src/ledger/crypto-state';
import { type Migration, MIGRATIONS, openLedger } from '../../../src/ledger/migrations';
import { rawRows } from '../crypto/raw-store';
import { expectLedgerError, uniqueDbName } from './fixtures';

const latest = MIGRATIONS.at(-1)?.version ?? 0;
/** A version past the shipped ones whose upgrade writes a sealed table's row blind. */
const WRITES_A_GRANT: readonly Migration[] = [
  ...MIGRATIONS,
  {
    version: latest + 1,
    stores: {},
    upgrade: async (tx) => {
      await tx.table('grants').put({ agent: 'muse', note: 'invented upgrade row' });
    },
  },
];

let name: string;

beforeEach(() => {
  name = uniqueDbName('migrations-sealed');
});

afterEach(() => {
  clearKeyring();
});

/** A ledger at the shipped schema, encryption on or off as `meta` says. */
async function ledgerAtShipped(sealing: boolean): Promise<void> {
  const db = await openLedger(name);
  if (sealing) await db.meta.put({ key: CRYPTO_KEYS.SEALING, value: true });
  db.close();
}

describe('a schema upgrade', () => {
  it('on an encrypted ledger, cannot write a sealed table: the ledger does not open, and no row is plain', async () => {
    await ledgerAtShipped(true);
    await expectLedgerError(openLedger(name, WRITES_A_GRANT), 'open_failed');
    expect(await rawRows(name, 'grants')).toEqual([]);
  });

  it('on a ledger without encryption, writes as it always did', async () => {
    await ledgerAtShipped(false);
    const db = await openLedger(name, WRITES_A_GRANT);
    expect(await rawRows(name, 'grants')).toEqual([{ agent: 'muse', note: 'invented upgrade row' }]);
    db.close();
  });
});
