/**
 * PLACEHOLDER SCHEMAS (Sprint 0).
 *
 * These mirror build_spec.md §7 so the ledger and the bus are Zod-typed from day one. Sprint 1 task 1.0
 * moves the canonical schemas to `src/core/schema.ts` (with branded primitives and full tests) and these
 * become re-exports. Do not add fields here that §7 does not define.
 *
 * Every object schema is strict: unknown keys are rejected, so nothing outside the allowlist can be
 * smuggled into storage (Hard Rule 2).
 */
import { z } from 'zod';

export const Ulid = z.ulid();
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'expected lowercase hex SHA-256');
/** ISO 8601 with an explicit offset (`Z` or `±hh:mm`). */
export const IsoTs = z.iso.datetime({ offset: true });

export const AgentId = z.enum(['muse', 'chatgpt', 'dots', 'claude']);

export const ActionType = z.enum([
  'email.sent',
  'calendar.created',
  'calendar.updated',
  'calendar.deleted',
  'purchase.made',
  'subscription.changed',
  'listing.posted',
  'message.sent',
  'other',
]);

export const Request = z.strictObject({
  id: Ulid,
  agent: AgentId,
  conversationId: z.string(),
  textHint: z.string().max(200),
  textHash: Sha256,
  ts: IsoTs,
});

export const Claim = z.strictObject({
  id: Ulid,
  agent: AgentId,
  requestId: Ulid.optional(),
  type: ActionType,
  counterparty: z.string().optional(),
  amountCents: z.number().int().optional(),
  currency: z.string().length(3).optional(),
  subjectHint: z.string().max(80).optional(),
  claimedAt: IsoTs,
  observedAt: IsoTs,
  sourceKind: z.enum(['activity_view', 'chat', 'notification', 'settings']),
  extractor: z.strictObject({
    id: z.string(),
    version: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  rawHash: Sha256,
});

export const ObservationSource = z.enum(['gmail.sent', 'gmail.receipt', 'gcal.event']);

export const Observation = z.strictObject({
  id: Ulid,
  source: ObservationSource,
  type: ActionType,
  counterparty: z.string().optional(),
  merchant: z.string().optional(),
  amountCents: z.number().int().optional(),
  currency: z.string().length(3).optional(),
  subjectHint: z.string().max(80).optional(),
  occurredAt: IsoTs,
  observedAt: IsoTs,
  contentHash: Sha256,
});

export const Grant = z.strictObject({
  agent: AgentId,
  allowedTypes: z.array(ActionType),
  counterpartyAllowlist: z.array(z.string()),
  spendCeilingCents: z.number().int().nullable(),
  declaredScopes: z.array(z.string()),
  observedScopes: z.array(z.string()).optional(),
  updatedAt: IsoTs,
});

export const Grade = z.enum(['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE']);

export const Receipt = z.strictObject({
  id: Ulid,
  claimId: Ulid.optional(),
  observationIds: z.array(Ulid),
  requestId: Ulid.optional(),
  grade: Grade,
  confidence: z.number().min(0).max(1),
  ruleId: z.string(),
  reasons: z.array(z.string()),
  signals: z.record(z.string(), z.number()),
  state: z.enum(['PENDING', 'FINAL', 'USER_OVERRIDDEN']),
  inputsHash: Sha256,
  computedAt: IsoTs,
  finalAt: IsoTs.optional(),
});

/** Latest health result per adapter/observer (Hard Rule 6: DEGRADED is stored and shown). */
export const AdapterHealth = z.strictObject({
  adapterId: z.string().min(1),
  version: z.string().min(1),
  status: z.enum(['OK', 'DEGRADED']),
  reasons: z.array(z.string()),
  checkedAt: IsoTs,
});

/** What an observer could see, and when (Hard Rule 5: no coverage → UNVERIFIABLE). */
export const CoveragePing = z.strictObject({
  observerId: z.string().min(1),
  /** SHA-256 of the account identifier; never the identifier itself. */
  accountHash: Sha256.optional(),
  lastSyncAt: IsoTs,
  windowStart: IsoTs,
  windowEnd: IsoTs,
  userActive: z.boolean(),
});

/** Small key/value facts about the ledger itself (schema version, last purge, …). */
export const MetaEntry = z.strictObject({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export type AgentId = z.infer<typeof AgentId>;
export type ActionType = z.infer<typeof ActionType>;
export type Request = z.infer<typeof Request>;
export type Claim = z.infer<typeof Claim>;
export type ObservationSource = z.infer<typeof ObservationSource>;
export type Observation = z.infer<typeof Observation>;
export type Grant = z.infer<typeof Grant>;
export type Grade = z.infer<typeof Grade>;
export type Receipt = z.infer<typeof Receipt>;
export type AdapterHealth = z.infer<typeof AdapterHealth>;
export type CoveragePing = z.infer<typeof CoveragePing>;
export type MetaEntry = z.infer<typeof MetaEntry>;
