/**
 * What the encryption tests of the service worker store (sprint_6 6.5): one row of each content table, from the ledger
 * fixtures' invented values, and the values that must never be readable at rest. Import 'fake-indexeddb/auto' first.
 */
import { DEFAULT_POLICY } from '../../../src/core/policy';
import type { LedgerDb } from '../../../src/ledger/db';
import { putGrant, putReceipt, putRequest, upsertClaim, upsertObservation } from '../../../src/ledger/repo';
import { makeClaim, makeGrant, makeObservation, makeReceipt, makeRequest } from '../ledger/fixtures';

export const CLAIM = makeClaim();
export const OBSERVATION = makeObservation();
export const REQUEST = makeRequest();
export const RECEIPT = makeReceipt();
export const GRANT = makeGrant();

/** The content tables the fixtures fill. */
export const SEALED_STORES = ['requests', 'claims', 'observations', 'receipts', 'grants'] as const;

/** The fixtures' invented content, which must never be readable at rest. */
export const CONTENT = [
  'alice@example.com',
  'Quarterly numbers',
  'Email Alice',
  'example.com',
  'muse.activity',
];

/** Stores one row of each content table. */
export async function seedLedger(db: LedgerDb): Promise<void> {
  await putRequest(db, REQUEST);
  await upsertClaim(db, CLAIM);
  await upsertObservation(db, OBSERVATION, DEFAULT_POLICY);
  await putReceipt(db, RECEIPT);
  await putGrant(db, GRANT);
}
