/**
 * The ledger's schemas: re-exports of the canonical core schemas (src/core/schema.ts, docs/grading.md §13),
 * plus the two storage-only shapes the core does not grade with (CoveragePing, MetaEntry).
 *
 * Every object schema is strict: unknown keys are rejected, so nothing outside the allowlist can be smuggled
 * into storage (Hard Rule 2). Every free-text string and array is capped by SCHEMA_LIMITS (SECURITY-4).
 */
import { z } from 'zod';

import { PolicyDocument } from '../core/policy';
import {
  ComponentId,
  Coverage,
  GradeContext,
  Grant,
  IsoTs,
  ObservationSource,
  SCHEMA_LIMITS,
  Sha256,
} from '../core/schema';
import { coverageProblems, refineWith } from '../core/schema-checks';

export * from '../core/schema';
/** The ledger's name for a HealthReport: the latest health per adapter/observer (Hard Rule 6). */
export { HealthReport as AdapterHealth } from '../core/schema';
export type { HealthReportInput as AdapterHealthInput } from '../core/schema';

const L = SCHEMA_LIMITS;

/**
 * What one observer pass could see, and when (Hard Rule 5: no coverage → UNVERIFIABLE): the `coverage.ping` an
 * observer posts, one per window it saw (sprint_2 2.7 interface 1). The service worker turns an accepted ping into a
 * core `ObserverCoverage` interval (./coverage.ts `recordCoverage`) and keeps the latest ping per observer and
 * account in the v1 `coverage` table. `source` names the one source the observer reads; `allCalendars` is a
 * `gcal.event` fact only, checked as core `coverageProblems` checks it. A ping never carries `changesSince`: only
 * the ledger sets it, from its stored Calendar snapshots (./calendar-snapshots.ts). `userActive` feeds Sprint 3.5
 * activity, never coverage.
 */
export const CoveragePing = z
  .strictObject({
    observerId: ComponentId,
    source: ObservationSource,
    /** SHA-256 of the account identifier; never the identifier itself. */
    accountHash: Sha256.optional(),
    lastSyncAt: IsoTs,
    windowStart: IsoTs,
    windowEnd: IsoTs,
    allCalendars: z.boolean().optional(),
    userActive: z.boolean(),
  })
  .superRefine(refineWith(coverageProblems));

/**
 * Small key/value facts about the ledger itself (schema version, last purge, last batch instant, …). The key is
 * a developer-chosen token (`ComponentId`), never text.
 */
export const MetaEntry = z.strictObject({
  key: ComponentId,
  value: z.union([z.string().max(L.META_VALUE), z.number(), z.boolean()]),
});

/**
 * What one receipt was graded with besides its subject and candidates (docs/grading.md §9): the batch's coverage, the
 * agent's grant in force, the grading context and the policy's hash. Derived data only: the same fields the receipt's
 * `inputsHash` binds, no content (Hard Rule 2). The `pnpm attest replay` export holds one per receipt.
 */
export const ReceiptInputs = z.strictObject({
  coverage: Coverage,
  grant: Grant,
  context: GradeContext,
  policyHash: Sha256,
});

/** A `receiptInputs` row: the inputs keyed by the receipt's `inputsHash`. */
export const ReceiptInputsRecord = ReceiptInputs.extend({ inputsHash: Sha256 });

/** A `policies` row: a policy document as policy/default.json writes one, keyed by its `policyHash`. */
export const PolicyRecord = z.strictObject({ policyHash: Sha256, document: PolicyDocument });

export type CoveragePing = z.infer<typeof CoveragePing>;
export type CoveragePingInput = z.input<typeof CoveragePing>;
export type MetaEntry = z.infer<typeof MetaEntry>;
export type ReceiptInputs = z.infer<typeof ReceiptInputs>;
export type ReceiptInputsRecord = z.infer<typeof ReceiptInputsRecord>;
export type PolicyRecord = z.infer<typeof PolicyRecord>;
