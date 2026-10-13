import 'fake-indexeddb/auto';
/**
 * The cipher loads only for a ledger that may hold sealed rows (src/crypto/cipher.ts; Sprint 6 close, tech review
 * TECH-1), each case with the modules fresh, as a page starts: loading the keyring of a ledger never encrypted leaves
 * the cipher unloaded; of an encrypted one, loads it; a sealed row met before it is loaded fails as locked, never read
 * in part, and reads whole once it is; and the service worker has it from its start, as Chrome refuses `import()` in a
 * service worker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CRYPTO_KEYS } from '../../../src/ledger/crypto-state';
import { makeClaim, uniqueDbName } from '../ledger/fixtures';

const KEY = { id: 'aaaaaaaaaaaa', bytes: Uint8Array.from({ length: 32 }, (_, i) => i + 5) };
const CLAIM = makeClaim();

/** The modules a page starts with, fresh. */
async function fresh() {
  vi.resetModules();
  const [cipher, keyring, state, migrations, repo] = await Promise.all([
    import('../../../src/crypto/cipher'),
    import('../../../src/crypto/keyring'),
    import('../../../src/ledger/crypto-state'),
    import('../../../src/ledger/migrations'),
    import('../../../src/ledger/repo'),
  ]);
  return { cipher, keyring, state, migrations, repo };
}

afterEach(() => {
  vi.resetModules();
});

describe('the cipher', () => {
  it("is the service worker's from its start, so it never needs the import() Chrome refuses there", async () => {
    vi.resetModules();
    const [crypto, cipher] = await Promise.all([
      import('../../../src/background/crypto'),
      import('../../../src/crypto/cipher'),
    ]);
    expect(cipher.cipher()).toBeUndefined();
    crypto.holdKeysHere();
    expect(cipher.cipher()).toBeDefined();
  });

  it('stays unloaded for a ledger never encrypted, and loads for an encrypted one', async () => {
    const page = await fresh();
    const db = await page.migrations.openLedger(uniqueDbName('cipher'));
    await page.state.loadKeyring(db, () => Promise.resolve({}));
    expect(page.cipher.cipher()).toBeUndefined();
    await db.meta.put({ key: CRYPTO_KEYS.SEALING, value: true });
    await page.state.loadKeyring(db, () => Promise.resolve({ current: KEY }));
    expect(page.cipher.cipher()).toBeDefined();
    db.close();
  });

  it('fails a sealed row as locked until it loads, then reads it whole', async () => {
    const name = uniqueDbName('cipher');
    const writer = await fresh();
    await writer.cipher.loadCipher();
    const sealedBy = await writer.migrations.openLedger(name);
    writer.keyring.setKeyring({ sealing: true, guarded: true, current: KEY });
    await writer.repo.upsertClaim(sealedBy, CLAIM);
    const stored = await writer.repo.getClaim(sealedBy, CLAIM.id);
    sealedBy.close();

    const page = await fresh();
    const db = await page.migrations.openLedger(name);
    page.keyring.setKeyring({ sealing: true, guarded: true, current: KEY });
    // A LedgerError of the fresh modules, so by its name and code rather than its class.
    await expect(page.repo.getClaim(db, CLAIM.id)).rejects.toMatchObject({
      name: 'LedgerError',
      code: 'locked',
    });
    await page.cipher.loadCipher();
    expect(await page.repo.getClaim(db, CLAIM.id)).toEqual(stored);
    db.close();
  });
});
