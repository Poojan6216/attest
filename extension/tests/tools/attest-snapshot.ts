/**
 * The `attest replay` input format: a ledger export (src/ledger/export.ts `LedgerExport`, the Sprint 0 shape) plus
 * the three things replay needs that the Sprint 0 tables do not hold (docs/grading.md §9):
 *
 *   {
 *     "format": "attest-ledger",
 *     "schemaVersion": 1,
 *     "exportedAt": "2026-10-02T09:00:00+00:00",
 *     "tables": {
 *       "requests": [Request], "claims": [Claim], "observations": [Observation], "grants": [Grant],
 *       "receipts": [Receipt], "adapterHealth": [HealthReport], "coverage": [CoveragePing], "meta": [MetaEntry]
 *     },
 *     "receiptInputs": {
 *       "<inputsHash>": { "coverageHash": "<sha256>", "grant": Grant, "context": GradeContext, "policyHash": "<sha256>" }
 *     },
 *     "batchCoverages": { "<coverageHash>": Coverage },
 *     "policies": { "<policyHash>": <the policy document, written as policy/default.json is> }
 *   }
 *
 * Every object is validated by its strict schema (src/core/schema.ts; unknown keys are rejected, Hard Rule 2).
 * `receiptInputs` is keyed by the receipt's `inputsHash` and holds what that receipt was graded with besides its
 * subject and candidates, naming its batch's coverage by hash (schema v7: one coverage per batch, stored once):
 * derived data only, no content. Each coverage must hash to its own key, every input's coverage must be there, and
 * each policy document is loaded with `loadPolicy` and must hash to its own key. Replay reads `tables.claims`,
 * `tables.observations`, `tables.receipts`, `receiptInputs` (each joined with its coverage), `batchCoverages` and
 * `policies`; the other tables are validated and carried as exported.
 *
 * Node-side tooling (runs under tsx): not part of the extension.
 */
import { z } from 'zod';

import { loadPolicy, type Policy, PolicyError } from '../../src/core/policy';
import { formatPath } from '../../src/core/policy-errors';
import { coverageHash } from '../../src/core/receipt';
import type { LedgerSnapshot, ReceiptInputs } from '../../src/core/replay';
import { Coverage, type Grant, Sha256 } from '../../src/core/schema';
import { LEDGER_EXPORT_FORMAT, LedgerExport } from '../../src/ledger/export';
import { ReceiptInputsRef } from '../../src/ledger/types';

import { printable } from './printable';

/** One `receiptInputs` row (§9): the ledger's own schema (src/ledger/types.ts), so the two never drift apart. */
export const ReceiptInputsRow = ReceiptInputsRef;

/** The replay export: the Sprint 0 ledger export plus the three replay maps. Strict at every level. */
export const ReplayExport = LedgerExport.extend({
  receiptInputs: z.record(Sha256, ReceiptInputsRow),
  batchCoverages: z.record(Sha256, Coverage),
  policies: z.record(Sha256, z.unknown()),
});

export type ReplayExport = z.infer<typeof ReplayExport>;

export type SnapshotErrorCode = 'invalid_snapshot' | 'policy_hash' | 'coverage_hash';

/**
 * An export replay cannot read. The message names paths and problems, never values (Hard Rule 10): a key from the
 * file appears only inside a path, JSON-quoted, and nothing non-printable from the file is ever written raw
 * (printable.ts), so a crafted export cannot drive the operator's terminal.
 */
export class SnapshotError extends Error {
  constructor(
    readonly code: SnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The most issues an error message lists; the rest are counted. */
const MAX_ISSUES = 10;

/**
 * One "path: problem" line per issue, the path as policy-errors.ts writes it (a key that is not a plain identifier
 * JSON-quoted). Zod's own message is used only for issues whose message holds no input: an unknown key is named by
 * its path with "unknown key", an invalid record key with "invalid key".
 */
function issueLines(issue: z.core.$ZodIssue): string[] {
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => `${formatPath([...issue.path, key])}: unknown key`);
  }
  const problem = issue.code === 'invalid_key' ? 'invalid key' : issue.message;
  return [`${formatPath(issue.path)}: ${problem}`];
}

function describeIssues(error: z.ZodError): string {
  const lines = error.issues.flatMap(issueLines);
  const listed = lines.slice(0, MAX_ISSUES).map((line) => `  ${printable(line)}`);
  const more = lines.length - MAX_ISSUES;
  return [...listed, ...(more > 0 ? [`  … and ${String(more)} more`] : [])].join('\n');
}

/** Each policy document loaded, keyed by its key after checking it hashes to it. */
function loadPolicies(documents: Readonly<Record<string, unknown>>): Map<string, Policy> {
  const policies = new Map<string, Policy>();
  for (const [key, document] of Object.entries(documents)) {
    let policy: Policy;
    try {
      policy = loadPolicy(document);
    } catch (error) {
      if (!(error instanceof PolicyError)) throw error;
      const issues = error.issues.map((issue) => `  ${printable(issue)}`).join('\n');
      throw new SnapshotError('invalid_snapshot', `policies.${key} is not a valid policy:\n${issues}`);
    }
    if (policy.policyHash !== key) {
      throw new SnapshotError('policy_hash', `policies.${key}: the document hashes to ${policy.policyHash}`);
    }
    policies.set(key, policy);
  }
  return policies;
}

/**
 * Each receipt's inputs joined with its batch's coverage, after checking every coverage hashes to its key (one shared
 * object per coverage, as grading had it) and every input names one that is there.
 */
function joinInputs(
  inputs: Readonly<Record<string, ReceiptInputsRef>>,
  coverages: Readonly<Record<string, Coverage>>,
): Map<string, ReceiptInputs> {
  for (const [key, coverage] of Object.entries(coverages)) {
    const hash = coverageHash(coverage);
    if (hash !== key)
      throw new SnapshotError('coverage_hash', `batchCoverages.${key}: the coverage hashes to ${hash}`);
  }
  const joined = new Map<string, ReceiptInputs>();
  for (const [key, { coverageHash: hash, ...rest }] of Object.entries(inputs)) {
    const coverage = coverages[hash];
    if (coverage === undefined) {
      throw new SnapshotError(
        'invalid_snapshot',
        `receiptInputs.${key}.coverageHash names no batch coverage`,
      );
    }
    joined.set(key, { coverage, ...rest });
  }
  return joined;
}

/** Reads a parsed JSON value as a replay snapshot; throws SnapshotError when it is not one. */
export function readSnapshot(json: unknown): LedgerSnapshot {
  const parsed = ReplayExport.safeParse(json);
  if (!parsed.success) {
    throw new SnapshotError(
      'invalid_snapshot',
      `not an attest replay export:\n${describeIssues(parsed.error)}`,
    );
  }
  const { tables, receiptInputs, batchCoverages, policies } = parsed.data;
  return {
    claims: tables.claims,
    observations: tables.observations,
    receipts: tables.receipts,
    receiptInputs: joinInputs(receiptInputs, batchCoverages),
    policies: loadPolicies(policies),
  };
}

export interface ExportExtras {
  /** The ledger's grants table (replay reads grants from `receiptInputs`; the table is carried as exported). */
  readonly grants: readonly Grant[];
  /** The raw policy documents, keyed by policyHash. */
  readonly documents: ReadonlyMap<string, unknown>;
  readonly exportedAt: string;
}

/** A snapshot written in the replay export format (for tests and fixtures; the extension's exporter is Sprint 2.6). */
export function toReplayExport(snapshot: LedgerSnapshot, extras: ExportExtras): Record<string, unknown> {
  return {
    format: LEDGER_EXPORT_FORMAT,
    schemaVersion: 1,
    exportedAt: extras.exportedAt,
    tables: {
      requests: [],
      claims: snapshot.claims,
      observations: snapshot.observations,
      grants: extras.grants,
      receipts: snapshot.receipts,
      adapterHealth: [],
      coverage: [],
      meta: [],
    },
    ...splitInputs(snapshot.receiptInputs),
    policies: Object.fromEntries(extras.documents),
  };
}

/** Each receipt's inputs with its coverage named by hash, and each coverage once (the export's v7 form). */
function splitInputs(inputs: ReadonlyMap<string, ReceiptInputs>): {
  receiptInputs: Record<string, ReceiptInputsRef>;
  batchCoverages: Record<string, Coverage>;
} {
  const receiptInputs: Record<string, ReceiptInputsRef> = {};
  const batchCoverages: Record<string, Coverage> = {};
  for (const [key, { coverage, ...rest }] of inputs) {
    const hash = coverageHash(coverage);
    batchCoverages[hash] = coverage;
    receiptInputs[key] = { coverageHash: hash, ...rest };
  }
  return { receiptInputs, batchCoverages };
}
