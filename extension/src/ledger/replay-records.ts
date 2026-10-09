/**
 * The replay records (sprint_3 3.13; docs/grading.md §9; Hard Rule 4): what each stored receipt was graded with
 * besides its subject and candidates (`receiptInputs`, by the receipt's `inputsHash`), and the policy documents
 * receipts name (`policies`, by `policyHash`), so `pnpm attest replay` reproduces every receipt from an export.
 * Written only by a grading batch, inside its readwrite transaction, beside the receipts they belong to
 * (src/background/grading.ts); purged with those receipts (./retention.ts); exported as the two maps the replay input
 * holds (./export.ts). Derived data only: the facts `inputsHash` binds, never content (Hard Rule 2).
 */
import type { z } from 'zod';

import { canonicalJson, sha256Hex } from '../core/hash';
import type { Policy } from '../core/policy';
import { PolicyDocument } from '../core/policy-document';
import { compareText } from '../core/order';
import { readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import { PolicyRecord, type ReceiptInputs, ReceiptInputsRecord } from './types';

export type ReceiptInputsInput = z.input<typeof ReceiptInputs>;

/** Stores what a receipt was graded with under its `inputsHash`: the same hash always names the same inputs. */
export async function putReceiptInputs(
  db: LedgerDb,
  inputsHash: string,
  inputs: ReceiptInputsInput,
): Promise<void> {
  const parsed = ReceiptInputsRecord.safeParse({ ...inputs, inputsHash });
  if (!parsed.success) {
    throw new LedgerError('invalid_input', 'Invalid receipt inputs', { issues: parsed.error.issues.length });
  }
  await db.receiptInputs.put(parsed.data);
}

/** Deletes the inputs of receipts that were regraded or deleted (a hash no stored receipt names any more). */
export async function deleteReceiptInputs(db: LedgerDb, inputsHashes: Iterable<string>): Promise<void> {
  await db.receiptInputs.bulkDelete([...inputsHashes]);
}

/**
 * Stores the document of `policy` once: refused (`invalid_input`) unless it is a valid policy document whose canonical
 * JSON hashes to the policy's own `policyHash` (how ../core/policy.ts `loadPolicy` names a policy), so an export's
 * documents always reproduce the hashes its receipts name. Checked by hash, never by loading it, so the ledger never
 * imports the shipped policy file (../core/policy-document.ts).
 */
export async function putPolicyDocument(
  db: LedgerDb,
  policy: Pick<Policy, 'policyHash'>,
  document: unknown,
): Promise<void> {
  if ((await db.policies.get(policy.policyHash)) !== undefined) return;
  const parsed = PolicyDocument.safeParse(document, { jitless: true });
  if (!parsed.success || sha256Hex(canonicalJson(parsed.data)) !== policy.policyHash) {
    throw new LedgerError('invalid_input', 'The policy document does not hash to the policy', {
      field: 'document',
    });
  }
  await db.policies.put(PolicyRecord.parse({ policyHash: policy.policyHash, document: parsed.data }));
}

/** What the replay input holds besides the ledger tables (tests/tools/attest-snapshot.ts): both maps, keys sorted. */
export interface ReplayRecords {
  readonly receiptInputs: Record<string, ReceiptInputs>;
  readonly policies: Record<string, PolicyDocument>;
}

/** The replay records as the export writes them. Reads in the caller's transaction when there is one. */
export async function replayRecords(db: LedgerDb): Promise<ReplayRecords> {
  const inputs = readRows('receiptInputs', ReceiptInputsRecord, await db.receiptInputs.toArray());
  const documents = readRows('policies', PolicyRecord, await db.policies.toArray());
  inputs.sort((a, b) => compareText(a.inputsHash, b.inputsHash));
  documents.sort((a, b) => compareText(a.policyHash, b.policyHash));
  return {
    receiptInputs: Object.fromEntries(inputs.map(({ inputsHash, ...rest }) => [inputsHash, rest])),
    policies: Object.fromEntries(documents.map(({ policyHash, document }) => [policyHash, document])),
  };
}

/**
 * The purge's part (./retention.ts rule 8): the inputs of the purged receipts, then every policy document no stored
 * input names any more. Runs in the purge's transaction. Returns how many rows of each went.
 */
export async function purgeReplayRecords(
  db: LedgerDb,
  purgedInputsHashes: Iterable<string>,
): Promise<{ readonly receiptInputs: number; readonly policies: number }> {
  const hashes = [...new Set(purgedInputsHashes)];
  const held = (await db.receiptInputs.bulkGet(hashes)).filter((row) => row !== undefined).length;
  await db.receiptInputs.bulkDelete(hashes);
  const unnamed: string[] = [];
  for (const policyHash of await db.policies.toCollection().primaryKeys()) {
    if ((await db.receiptInputs.where('policyHash').equals(policyHash).count()) === 0)
      unnamed.push(policyHash);
  }
  await db.policies.bulkDelete(unnamed);
  return { receiptInputs: held, policies: unnamed.length };
}
