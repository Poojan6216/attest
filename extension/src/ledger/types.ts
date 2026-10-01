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

/**
 * Length caps on every free-text string and every array (SECURITY-4, Hard Rule 2). §7 caps textHint (200)
 * and subjectHint (80); these cap the rest, so an extractor bug or a compromised content script cannot push
 * a whole email body through `counterparty` into storage and exports. Sprint 1.0 carries them into
 * src/core/schema.ts (Decisions.md [0.close]).
 */
export const SCHEMA_LIMITS = Object.freeze({
  /** RFC 5321: 64-char local part + '@' + 255-char domain. */
  COUNTERPARTY: 320,
  MERCHANT: 120,
  CONVERSATION_ID: 128,
  /** Adapter, observer, extractor and rule ids; versions; signal names. */
  ID: 64,
  /** One human-readable reason, scope, or allowlist entry. */
  ITEM: 120,
  /** Reasons on one receipt or health report; signals on one receipt. */
  REASONS: 32,
  /** Entries in one grant list (allowlist, declared or observed scopes). */
  LIST: 200,
  /** Items in one bus batch, observation ids on one receipt. */
  BATCH: 500,
  META_VALUE: 256,
});

const L = SCHEMA_LIMITS;
const Id = z.string().min(1).max(L.ID);

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
  conversationId: z.string().max(L.CONVERSATION_ID),
  textHint: z.string().max(200),
  textHash: Sha256,
  ts: IsoTs,
});

export const Claim = z.strictObject({
  id: Ulid,
  agent: AgentId,
  requestId: Ulid.optional(),
  type: ActionType,
  counterparty: z.string().max(L.COUNTERPARTY).optional(),
  amountCents: z.number().int().optional(),
  currency: z.string().length(3).optional(),
  subjectHint: z.string().max(80).optional(),
  claimedAt: IsoTs,
  observedAt: IsoTs,
  sourceKind: z.enum(['activity_view', 'chat', 'notification', 'settings']),
  extractor: z.strictObject({
    id: z.string().max(L.ID),
    version: z.string().max(L.ID),
    confidence: z.number().min(0).max(1),
  }),
  rawHash: Sha256,
});

export const ObservationSource = z.enum(['gmail.sent', 'gmail.receipt', 'gcal.event']);

export const Observation = z.strictObject({
  id: Ulid,
  source: ObservationSource,
  type: ActionType,
  counterparty: z.string().max(L.COUNTERPARTY).optional(),
  merchant: z.string().max(L.MERCHANT).optional(),
  amountCents: z.number().int().optional(),
  currency: z.string().length(3).optional(),
  subjectHint: z.string().max(80).optional(),
  occurredAt: IsoTs,
  observedAt: IsoTs,
  contentHash: Sha256,
});

export const Grant = z.strictObject({
  agent: AgentId,
  allowedTypes: z.array(ActionType).max(ActionType.options.length),
  counterpartyAllowlist: z.array(z.string().max(L.COUNTERPARTY)).max(L.LIST),
  spendCeilingCents: z.number().int().nullable(),
  declaredScopes: z.array(z.string().max(L.ITEM)).max(L.LIST),
  observedScopes: z.array(z.string().max(L.ITEM)).max(L.LIST).optional(),
  updatedAt: IsoTs,
});

export const Grade = z.enum(['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE']);

export const Receipt = z.strictObject({
  id: Ulid,
  claimId: Ulid.optional(),
  observationIds: z.array(Ulid).max(L.BATCH),
  requestId: Ulid.optional(),
  grade: Grade,
  confidence: z.number().min(0).max(1),
  ruleId: z.string().max(L.ID),
  reasons: z.array(z.string().max(L.ITEM)).max(L.REASONS),
  signals: z
    .record(z.string().max(L.ID), z.number())
    .refine((signals) => Object.keys(signals).length <= L.REASONS, `at most ${String(L.REASONS)} signals`),
  state: z.enum(['PENDING', 'FINAL', 'USER_OVERRIDDEN']),
  inputsHash: Sha256,
  computedAt: IsoTs,
  finalAt: IsoTs.optional(),
});

/** Latest health result per adapter/observer (Hard Rule 6: DEGRADED is stored and shown). */
export const AdapterHealth = z.strictObject({
  adapterId: Id,
  version: Id,
  status: z.enum(['OK', 'DEGRADED']),
  reasons: z.array(z.string().max(L.ITEM)).max(L.REASONS),
  checkedAt: IsoTs,
});

/** What an observer could see, and when (Hard Rule 5: no coverage → UNVERIFIABLE). */
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
