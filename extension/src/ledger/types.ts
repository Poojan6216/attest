/**
 * The ledger's schemas: re-exports of the canonical core schemas (src/core/schema.ts, docs/grading.md §13),
 * plus the two storage-only shapes the core does not grade with (CoveragePing, MetaEntry).
 *
 * Every object schema is strict: unknown keys are rejected, so nothing outside the allowlist can be smuggled
 * into storage (Hard Rule 2). Every free-text string and array is capped by SCHEMA_LIMITS (SECURITY-4).
 */
import { z } from 'zod';

import { PolicyDocument } from '../core/policy-document';
import { instantMs } from '../core/normalize';
import {
  AgentId,
  ComponentId,
  Coverage,
  GradeContext,
  Grant,
  IsoTs,
  ObservationSource,
  SCHEMA_LIMITS,
  Sha256,
  Ulid,
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

/**
 * A `receiptInputs` row (schema v7; tech review TECH-1): the inputs keyed by the receipt's `inputsHash`, naming the
 * batch's coverage by its `coverageHash` (a `batchCoverages` row) instead of holding a copy of it: every receipt of
 * a batch was graded with the same coverage, which is stored once.
 */
export const ReceiptInputsRecord = z.strictObject({
  inputsHash: Sha256,
  coverageHash: Sha256,
  grant: Grant,
  context: GradeContext,
  policyHash: Sha256,
});

/** A `receiptInputs` row as the export writes it: keyed by its `inputsHash`, so without it. */
export const ReceiptInputsRef = ReceiptInputsRecord.omit({ inputsHash: true });

/** A `batchCoverages` row (schema v7): one batch's coverage, keyed by its `coverageHash` (src/core/receipt.ts). */
export const BatchCoverageRecord = z.strictObject({ coverageHash: Sha256, coverage: Coverage });

/**
 * An `activity` row (sprint_3 3.14, ./activity.ts): a moment an agent's own log says it worked (`session`: a pasted
 * entry's time), or an interval Chrome reported the person away (`idle`, opt-in), `from` no later than `to`. Instants
 * and an agent id only. `id` is the SHA-256 that keeps each once.
 */
export const ActivityRecord = z
  .discriminatedUnion('kind', [
    z.strictObject({ id: Sha256, kind: z.literal('session'), agent: AgentId, at: IsoTs }),
    z.strictObject({ id: Sha256, kind: z.literal('idle'), from: IsoTs, to: IsoTs }),
  ])
  .superRefine((record, ctx) => {
    if (record.kind === 'idle' && instantMs(record.from) > instantMs(record.to)) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'an interval ends at or after it starts' });
    }
  });

/** A `policies` row: a policy document as policy/default.json writes one, keyed by its `policyHash`. */
export const PolicyRecord = z.strictObject({ policyHash: Sha256, document: PolicyDocument });

/** The grades a FINAL receipt alerts on (sprint_4 4.6): never VERIFIED, PARTIAL or UNVERIFIABLE. */
export const AlertGrade = z.enum(['NOT_FOUND', 'UNASKED', 'OVER_SCOPE']);

/**
 * What became of an alert (sprint_4 4.6; ./alerts.ts): `pending` until the service worker handles it, then once and
 * for good `shown` (a notification was asked for), `muted` (the person muted that agent's alerts), `superseded` (an
 * UNASKED receipt a later claim explained), `overridden` (the person marked the receipt first) or `gone` (the receipt
 * was purged first).
 */
export const AlertState = z.enum(['pending', 'shown', 'muted', 'superseded', 'overridden', 'gone']);

/**
 * An `alerts` row (sprint_4 4.6, ./alerts.ts): one per receipt a grading batch made FINAL with an alerting grade, keyed
 * by the receipt's id, so a receipt alerts once, ever. Ids, the agent, the grade, the state and two instants only.
 */
export const AlertRecord = z.strictObject({
  receiptId: Ulid,
  agent: AgentId,
  grade: AlertGrade,
  state: AlertState,
  /** The receipt's `finalAt`: when grading made it FINAL. */
  finalAt: IsoTs,
  /** When the service worker handled it; absent while `pending`. */
  handledAt: IsoTs.optional(),
});

export type CoveragePing = z.infer<typeof CoveragePing>;
export type CoveragePingInput = z.input<typeof CoveragePing>;
export type MetaEntry = z.infer<typeof MetaEntry>;
export type ReceiptInputs = z.infer<typeof ReceiptInputs>;
export type ReceiptInputsRef = z.infer<typeof ReceiptInputsRef>;
export type BatchCoverageRecord = z.infer<typeof BatchCoverageRecord>;
export type ActivityRecord = z.infer<typeof ActivityRecord>;
export type ActivityRecordInput = z.input<typeof ActivityRecord>;
export type ReceiptInputsRecord = z.infer<typeof ReceiptInputsRecord>;
export type PolicyRecord = z.infer<typeof PolicyRecord>;
export type AlertGrade = z.infer<typeof AlertGrade>;
export type AlertState = z.infer<typeof AlertState>;
export type AlertRecord = z.infer<typeof AlertRecord>;
