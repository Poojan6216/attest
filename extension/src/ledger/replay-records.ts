/**
 * The replay records (sprint_3 3.13; docs/grading.md §9; Hard Rule 4): what each stored receipt was graded with
 * besides its subject and candidates (`receiptInputs`, by the receipt's `inputsHash`), each batch's coverage those
 * inputs name (`batchCoverages`, by `coverageHash`, schema v7), and the policy documents receipts name (`policies`, by
 * `policyHash`), so `pnpm attest replay` reproduces every receipt from an export. Written only by a grading batch,
 * inside its readwrite transaction, beside the receipts they belong to (src/background/grading.ts); purged with those
 * receipts (./retention.ts); exported as the three maps the replay input holds (./export.ts). Derived data only: the
 * facts `inputsHash` binds, never content (Hard Rule 2).
 *
 * Every receipt of a batch was graded with one coverage, so it is stored once and each input names it by hash (tech
 * review TECH-1): a copy per receipt grew with every Calendar marker and was rewritten for every PENDING receipt by
 * every batch. A coverage goes when the last input naming it goes.
 */
import type { z } from 'zod';

import { canonicalJson, sha256Hex } from '../core/hash';
import type { Policy } from '../core/policy';
import { PolicyDocument } from '../core/policy-document';
import { compareText } from '../core/order';
import { coverageHash } from '../core/receipt';
import { Coverage } from '../core/schema';
import { readRows, type LedgerDb } from './db';
import { LedgerError } from './errors';
import {
  BatchCoverageRecord,
  PolicyRecord,
  type ReceiptInputs,
  ReceiptInputsRecord,
  type ReceiptInputsRef,
} from './types';

export type ReceiptInputsInput = z.input<typeof ReceiptInputs>;

function refused(issues: number): LedgerError {
  return new LedgerError('invalid_input', 'Invalid receipt inputs', { issues });
}

/** Stores `input` as a batch coverage once, and returns its `coverageHash`. */
async function putCoverage(db: LedgerDb, input: unknown): Promise<string> {
  const parsed = Coverage.safeParse(input);
  if (!parsed.success) throw refused(parsed.error.issues.length);
  const hash = coverageHash(parsed.data);
  if ((await db.batchCoverages.get(hash)) === undefined) {
    await db.batchCoverages.put({ coverageHash: hash, coverage: parsed.data });
  }
  return hash;
}

/**
 * Stores what each receipt of a batch was graded with under its `inputsHash` (`entries`, as core batch-store.ts
 * `storeBatch` returns them; the same hash always names the same inputs), and each distinct coverage once: the
 * receipts of a batch share one coverage object, which is parsed and hashed once. Refused (`invalid_input`, counts
 * only) unless every entry is valid.
 */
export async function putReceiptInputs(
  db: LedgerDb,
  entries: ReadonlyMap<string, ReceiptInputsInput>,
): Promise<void> {
  const named = new Map<unknown, string>();
  for (const [inputsHash, inputs] of entries) {
    const hash = named.get(inputs.coverage) ?? (await putCoverage(db, inputs.coverage));
    named.set(inputs.coverage, hash);
    const { grant, context, policyHash } = inputs;
    const parsed = ReceiptInputsRecord.safeParse({
      inputsHash,
      coverageHash: hash,
      grant,
      context,
      policyHash,
    });
    if (!parsed.success) throw refused(parsed.error.issues.length);
    await db.receiptInputs.put(parsed.data);
  }
}

/** Deletes each of `hashes` no stored input names any more; returns how many of them were stored. */
async function releaseCoverages(db: LedgerDb, hashes: Iterable<string>): Promise<number> {
  const unnamed: string[] = [];
  for (const hash of new Set(hashes)) {
    if ((await db.receiptInputs.where('coverageHash').equals(hash).count()) === 0) unnamed.push(hash);
  }
  const held = (await db.batchCoverages.bulkGet(unnamed)).filter((row) => row !== undefined).length;
  await db.batchCoverages.bulkDelete(unnamed);
  return held;
}

/**
 * Deletes the inputs of receipts that were regraded or deleted (a hash no stored receipt names any more), and each
 * coverage they named that no stored input names any more.
 */
export async function deleteReceiptInputs(db: LedgerDb, inputsHashes: Iterable<string>): Promise<void> {
  const hashes = [...new Set(inputsHashes)];
  const rows = readRows('receiptInputs', ReceiptInputsRecord, await db.receiptInputs.bulkGet(hashes));
  await db.receiptInputs.bulkDelete(hashes);
  await releaseCoverages(
    db,
    rows.map((row) => row.coverageHash),
  );
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

/** What the replay input holds besides the ledger tables (tests/tools/attest-snapshot.ts): three maps, keys sorted. */
export interface ReplayRecords {
  readonly receiptInputs: Record<string, ReceiptInputsRef>;
  readonly batchCoverages: Record<string, Coverage>;
  readonly policies: Record<string, PolicyDocument>;
}

/** The replay records as the export writes them. Reads in the caller's transaction when there is one. */
export async function replayRecords(db: LedgerDb): Promise<ReplayRecords> {
  const inputs = readRows('receiptInputs', ReceiptInputsRecord, await db.receiptInputs.toArray());
  const coverages = readRows('batchCoverages', BatchCoverageRecord, await db.batchCoverages.toArray());
  const documents = readRows('policies', PolicyRecord, await db.policies.toArray());
  inputs.sort((a, b) => compareText(a.inputsHash, b.inputsHash));
  coverages.sort((a, b) => compareText(a.coverageHash, b.coverageHash));
  documents.sort((a, b) => compareText(a.policyHash, b.policyHash));
  return {
    receiptInputs: Object.fromEntries(inputs.map(({ inputsHash, ...rest }) => [inputsHash, rest])),
    batchCoverages: Object.fromEntries(coverages.map(({ coverageHash: hash, coverage }) => [hash, coverage])),
    policies: Object.fromEntries(documents.map(({ policyHash, document }) => [policyHash, document])),
  };
}

/**
 * The purge's part (./retention.ts rule 8): the inputs of the purged receipts, then every batch coverage and every
 * policy document no stored input names any more. Runs in the purge's transaction. Returns how many rows of each went.
 */
export async function purgeReplayRecords(
  db: LedgerDb,
  purgedInputsHashes: Iterable<string>,
): Promise<{ readonly receiptInputs: number; readonly policies: number; readonly batchCoverages: number }> {
  const hashes = [...new Set(purgedInputsHashes)];
  const held = (await db.receiptInputs.bulkGet(hashes)).filter((row) => row !== undefined).length;
  await db.receiptInputs.bulkDelete(hashes);
  const unnamed: string[] = [];
  for (const policyHash of await db.policies.toCollection().primaryKeys()) {
    if ((await db.receiptInputs.where('policyHash').equals(policyHash).count()) === 0)
      unnamed.push(policyHash);
  }
  await db.policies.bulkDelete(unnamed);
  const batchCoverages = await releaseCoverages(db, await db.batchCoverages.toCollection().primaryKeys());
  return { receiptInputs: held, policies: unnamed.length, batchCoverages };
}
