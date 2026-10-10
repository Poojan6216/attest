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
  ActionType,
  AgentId,
  ComponentId,
  Coverage,
  Currency,
  Grade,
  HealthReport,
  GradeContext,
  Grant,
  IsoTs,
  ObservationSource,
  SCHEMA_LIMITS,
  Sha256,
  Ulid,
  AmountCents,
} from '../core/schema';
import { oneLineText } from '../core/schema-text';
import { coverageProblems, refineWith } from '../core/schema-checks';
import { Domain } from './domain';

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

/** A local calendar date, `YYYY-MM-DD`. */
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'must be a YYYY-MM-DD date');

const count = z.number().int().min(0);

/** One agent's week in a digest (sprint_4 4.7): its receipts graded that week, counted; every number stored. */
export const AgentWeek = z.strictObject({
  agent: AgentId,
  /** Receipts by grade, superseded ones aside: FINAL ones, and those the person marked, by Attest's own grade. */
  grades: z.strictObject(
    Object.fromEntries(Grade.options.map((grade) => [grade, count])) as Record<Grade, typeof count>,
  ),
  /** Still checking (PENDING) when the digest was made. */
  checking: count,
  /** Marked by the person (USER_OVERRIDDEN). */
  marked: count,
  /** Its FINAL claim receipts Attest could check (Verified, Partial, Not found, Over scope), and the Verified among them. */
  checked: count,
  verified: count,
});

/**
 * A receipt a digest calls out (sprint_4 4.7): FINAL NOT_FOUND, UNASKED or OVER_SCOPE, with what a share may show of
 * it: the action and its time, the counterparty's domain only (never the address or a name), the amount, and the
 * subject hint the ledger keeps.
 */
export const NotableReceipt = z.strictObject({
  receiptId: Ulid,
  agent: AgentId,
  grade: AlertGrade,
  type: ActionType.optional(),
  at: IsoTs.optional(),
  /** A domain only: an address's, or a merchant's written as one (./domain.ts; security review SEC-1). */
  domain: Domain.optional(),
  amountCents: AmountCents.optional(),
  currency: Currency.optional(),
  subjectHint: oneLineText(L.SUBJECT_HINT).optional(),
});

/**
 * A `digests` row (sprint_4 4.7; ./digest.ts): one week, Monday to Monday on the browser's clock, keyed by its Monday's
 * date, made by the weekly alarm and kept so the weeks can be read again. Counts, ids, dates, domains, amounts and
 * hints only, each read from the ledger when it was made: the digest page shows these and computes nothing.
 */
export const DigestRecord = z.strictObject({
  week: LocalDate,
  from: IsoTs,
  to: IsoTs,
  createdAt: IsoTs,
  agents: z.array(AgentWeek).max(AgentId.options.length),
  notable: z.array(NotableReceipt).max(L.LIST),
  /** How many notable receipts there were in all: `notable` keeps the newest `L.LIST`. */
  notableCount: count,
  /** Per source, the days of the week no window of it covered: Attest could not check them. */
  gaps: z
    .array(z.strictObject({ source: ObservationSource, days: z.array(LocalDate).max(7) }))
    .max(ObservationSource.options.length),
  /** Each reader's latest health when the digest was made. */
  health: z.array(HealthReport).max(L.LIST),
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
export type DigestRecord = z.infer<typeof DigestRecord>;
export type AgentWeek = z.infer<typeof AgentWeek>;
export type NotableReceipt = z.infer<typeof NotableReceipt>;
export type AlertState = z.infer<typeof AlertState>;
export type AlertRecord = z.infer<typeof AlertRecord>;
