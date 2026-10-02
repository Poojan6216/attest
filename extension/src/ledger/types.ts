/**
 * The ledger's schemas: re-exports of the canonical core schemas (src/core/schema.ts, docs/grading.md §13),
 * plus the two storage-only shapes the core does not grade with (CoveragePing, MetaEntry).
 *
 * Every object schema is strict: unknown keys are rejected, so nothing outside the allowlist can be smuggled
 * into storage (Hard Rule 2). Every free-text string and array is capped by SCHEMA_LIMITS (SECURITY-4).
 */
import { z } from 'zod';

import { IsoTs, SCHEMA_LIMITS, Sha256 } from '../core/schema';

export * from '../core/schema';
/** The ledger's name for a HealthReport: the latest health per adapter/observer (Hard Rule 6). */
export { HealthReport as AdapterHealth } from '../core/schema';
export type { HealthReportInput as AdapterHealthInput } from '../core/schema';

const L = SCHEMA_LIMITS;
const Id = z.string().min(1).max(L.ID);

/**
 * What an observer could see, and when (Hard Rule 5: no coverage → UNVERIFIABLE). The ledger's storage
 * shape until Sprint 2.6 reworks coverage storage into core `ObserverCoverage` intervals.
 */
export const CoveragePing = z.strictObject({
  observerId: Id,
  /** SHA-256 of the account identifier; never the identifier itself. */
  accountHash: Sha256.optional(),
  lastSyncAt: IsoTs,
  windowStart: IsoTs,
  windowEnd: IsoTs,
  userActive: z.boolean(),
});

/** Small key/value facts about the ledger itself (schema version, last purge, …). */
export const MetaEntry = z.strictObject({
  key: Id,
  value: z.union([z.string().max(L.META_VALUE), z.number(), z.boolean()]),
});

export type CoveragePing = z.infer<typeof CoveragePing>;
export type CoveragePingInput = z.input<typeof CoveragePing>;
export type MetaEntry = z.infer<typeof MetaEntry>;
