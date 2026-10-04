/**
 * The two `ObservationIndex` implementations the Sprint 1 candidate tests run against (Sprint 2.6 Done-when: same
 * test files, two implementations, assertions untouched): the in-memory index in core and the ledger's Dexie index
 * (src/ledger/index.ts) over a real ledger in fake-indexeddb.
 *
 * `createIndex(observations, bucketMinutes)` returns the index synchronously, as `createMemoryIndex` does, so a test
 * calls either one the same way. The Dexie index writes the rows it holds into a ledger first; its reads wait for
 * that write. One ledger per test file is reused: each `createIndex` replaces its observations, and a read through an
 * index made before the latest `createIndex` fails loud instead of reading another index's rows.
 *
 * `held(observations)` is what an implementation holds when given `observations`, and the rows a test should expect
 * results over. The memory index holds them as given. A ledger holds one row per `contentHash` (and so per id), only
 * rows the strict `Observation` schema accepts, and keeps a fact's first sighting: so the Dexie index holds, per
 * `contentHash`, the §4.1 representative (src/core/order.ts `representative`) of the schema-valid rows. For honest rows
 * that loses nothing `candidates()` reads: it keeps that same representative, and its first sighting is the earliest.
 * Rows the schema rejects (built without a parse: two ids under one `contentHash`, one id with two contents) are the
 * premise of the tests that say "a corrupt index could return them"; the ledger never returns one (db.ts `readRow`
 * skips it), so those tests run on the memory index only (`returnsUnparsedRows`), and
 * tests/unit/ledger/ledger-index.spec.ts proves the skip.
 *
 * `bucketMinutes` is the memory index's over-return granularity. The Dexie index reads the ledger's own buckets
 * (LEDGER_TIME_BUCKET_MINUTES) and trims every read to its exact range, which every bucket width allows.
 */
import 'fake-indexeddb/auto';

import type { ObservationIndex } from '../../../src/core/candidates';
import { representative } from '../../../src/core/order';
import { Observation } from '../../../src/core/schema';
import type { LedgerDb } from '../../../src/ledger/db';
import { toObservationRow } from '../../../src/ledger/index-fields';
import { createLedgerIndex } from '../../../src/ledger/index';
import { openLedger } from '../../../src/ledger/migrations';
import { uniqueDbName } from './fixtures';
import { type IndexImplementation, MEMORY_INDEX } from './index-implementations-memory';

export { type IndexImplementation, MEMORY_INDEX };

/** What one ledger holds when given `observations` (see the header). */
export function ledgerHeld(observations: readonly Observation[]): Observation[] {
  const byHash = new Map<string, Observation>();
  for (const observation of observations) {
    if (!Observation.safeParse(observation).success) continue;
    const held = byHash.get(observation.contentHash);
    byHash.set(observation.contentHash, held === undefined ? observation : representative(held, observation));
  }
  return [...byHash.values()];
}

let ledger: Promise<LedgerDb> | undefined;
let generation = 0;

function testLedger(): Promise<LedgerDb> {
  ledger ??= openLedger(uniqueDbName('candidate-index'));
  return ledger;
}

/** The Dexie index over a ledger holding `ledgerHeld(observations)`, written before any read. */
function createDexieIndex(observations: readonly Observation[]): ObservationIndex {
  generation += 1;
  const mine = generation;
  // Rows are built now, synchronously: a test may edit an observation in place after building its index.
  const rows = ledgerHeld(observations).map(toObservationRow);
  const ready = testLedger().then(async (db) => {
    await db.transaction('rw', db.observations, async () => {
      await db.observations.clear();
      await db.observations.bulkAdd(rows);
    });
    return createLedgerIndex(db);
  });
  const current = async (): Promise<ObservationIndex> => {
    if (mine !== generation)
      throw new Error('a Dexie test index was read after a later one replaced its rows');
    const index = await ready;
    if (mine !== generation)
      throw new Error('a Dexie test index was read after a later one replaced its rows');
    return index;
  };
  return {
    byTypeAndBucket: async (type, fromMs, toMs) => (await current()).byTypeAndBucket(type, fromMs, toMs),
    byCounterpartyToken: async (token, fromMs, toMs) =>
      (await current()).byCounterpartyToken(token, fromMs, toMs),
  };
}

export const DEXIE_INDEX: IndexImplementation = {
  name: 'dexie',
  createIndex: (observations) => createDexieIndex(observations),
  held: ledgerHeld,
  returnsUnparsedRows: false,
  bucketed: false,
};

/** Memory first: the property tests' tallies (generator coverage) are shared across both runs of a file. */
export const INDEX_IMPLEMENTATIONS: readonly IndexImplementation[] = [MEMORY_INDEX, DEXIE_INDEX];
