/**
 * The canonical schemas (docs/grading.md §3, §7, §13, §15; build_spec §7 with the §14 deviations).
 *
 * Every object is strict: an unknown key is an error, so nothing outside the allowlist reaches storage, the
 * bus or a hash (Hard Rule 2). Every free-text string and every array is capped (SCHEMA_LIMITS, SECURITY-4).
 * Ids, hashes and timestamps are branded, so a plain string cannot pass for a `Ulid` without a parse.
 * Cross-field invariants live in ./schema-checks. src/ledger/types.ts re-exports all of this.
 * PURE: no I/O, no clock, no locale (Hard Rule 4).
 *
 * This file is exempt from the core no-literal rule for SCHEMA_LIMITS only: a length cap is schema, not policy.
 */
import { z } from 'zod';

import {
  attributionProblems,
  claimProblems,
  coverageProblems,
  intervalProblems,
  MATCH_FEATURES,
  observationProblems,
  REASON_CODES,
  REASON_PARAM_KINDS,
  type ReasonParamKind,
  RECEIPT_SIGNALS,
  receiptProblems,
  refineReasonParams,
  refineWith,
  signalProblems,
} from './schema-checks';
import { BASIS_POINTS } from './units';

/** Length caps on every free-text string and every array (SECURITY-4, Hard Rule 2; Decisions [0.close]). */
export const SCHEMA_LIMITS = Object.freeze({
  /** RFC 5321: 64-char local part + '@' + 255-char domain. */
  COUNTERPARTY: 320,
  MERCHANT: 120,
  CONVERSATION_ID: 128,
  /** Adapter, observer, extractor and rule ids; versions; signal names. */
  ID: 64,
  /** One human-readable reason, scope, allowlist entry, or override reason. */
  ITEM: 120,
  /** Reasons on one receipt or health report (receipt signals are a closed set of names, §8). */
  REASONS: 32,
  /** Entries in one grant list (allowlist, declared or observed scopes). */
  LIST: 200,
  /** Items in one bus batch, observation ids on one receipt. */
  BATCH: 500,
  META_VALUE: 256,
  /** build_spec §7: the first 200 characters of a request, for display only. */
  TEXT_HINT: 200,
  /** Hard Rule 2: a subject hint is at most 80 characters. */
  SUBJECT_HINT: 80,
  /**
   * Characters in one timestamp: `YYYY-MM-DDThh:mm:ss.fffffffff+hh:mm`, nanoseconds with a numeric offset
   * (a `Z` timestamp of the same length can carry up to 14 fraction digits). Bounds storage, not precision.
   */
  ISO_TS: 35,
  /** docs/grading.md §13: every amountCents is an integer in [0, 10^12]. */
  AMOUNT_CENTS: 1_000_000_000_000,
  /** Account hashes bound to one source in a grant. */
  ACCOUNTS: 32,
  /** Coverage entries in one grading input; items in each Activity list. */
  GRADING_INPUT: 10_000,
});

const L = SCHEMA_LIMITS;

// ── Primitives ──────────────────────────────────────────────────────────────────────────────────

const ULID_UPPER = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const RULE_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
/** A visible character: not whitespace and not an invisible format mark (zero-width space, bidi, BOM). */
const VISIBLE = /[^\s\p{Cf}]/u;

/** Uppercase Crockford only, the form `idFromHash` emits: one id has exactly one spelling (Hard Rule 4). */
export const Ulid = z.ulid().regex(ULID_UPPER, 'expected an uppercase ULID').brand<'Ulid'>();
export const Sha256 = z.string().regex(SHA256_HEX, 'expected lowercase hex SHA-256').brand<'Sha256'>();
/** ISO 8601 with an explicit offset (`Z` or `±hh:mm`). */
export const IsoTs = z.iso.datetime({ offset: true }).max(L.ISO_TS).brand<'IsoTs'>();
/** Integer minor units, never negative (a refund cannot lower cumulative spend, §6.3). */
export const AmountCents = z.number().int().min(0).max(L.AMOUNT_CENTS);
/** ISO 4217 alphabetic code, uppercase (the form normalize.amount emits), so equal currencies compare equal. */
export const Currency = z.string().regex(/^[A-Z]{3}$/, 'expected an uppercase ISO 4217 code');
/** Rule ids end up in receipts and logs, so they are plain snake_case identifiers. */
export const RuleId = z.string().max(L.ID).regex(RULE_ID, 'expected a snake_case rule id');

const Id = z.string().min(1).max(L.ID);
/** A developer-chosen name (feature, signal, param): never content (Hard Rule 10). */
const Key = z.string().max(L.ID).regex(IDENTIFIER, 'expected an identifier');
const UnitInterval = z.number().min(0).max(1);

// ── Enums ───────────────────────────────────────────────────────────────────────────────────────

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

export const ObservationSource = z.enum(['gmail.sent', 'gmail.receipt', 'gcal.event']);
/** The unit containing `claimedAt`, in its own UTC offset (§4.1). */
export const ClaimPrecision = z.enum(['minute', 'hour', 'day']);
export const SourceKind = z.enum(['activity_view', 'chat', 'notification', 'settings']);
export const Grade = z.enum(['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE']);
/** The grades a user may override a receipt to (§8). */
export const OverrideGrade = z.enum(['VERIFIED', 'NOT_FOUND']);
export const ReceiptState = z.enum(['PENDING', 'FINAL', 'USER_OVERRIDDEN']);
export const UnaskedSignal = z.enum([
  'agentSessionActive',
  'userIdle',
  'agentSignature',
  'activityLogAdjacent',
]);

/** Closed, in docs/grading.md §15 table order (reasons are emitted in this order within each group). */
export const ReasonCode = z.enum(REASON_CODES);
/** The §5.1 match features; a receipt's `signals` keys are these plus `score` (§8). */
export const MatchFeature = z.enum(MATCH_FEATURES);
export const ReceiptSignal = z.enum(RECEIPT_SIGNALS);

// ── Agent side ──────────────────────────────────────────────────────────────────────────────────

export const Request = z.strictObject({
  id: Ulid,
  agent: AgentId,
  conversationId: z.string().max(L.CONVERSATION_ID),
  textHint: z.string().max(L.TEXT_HINT),
  textHash: Sha256,
  ts: IsoTs,
});

export const Claim = z
  .strictObject({
    id: Ulid,
    agent: AgentId,
    requestId: Ulid.optional(),
    type: ActionType,
    counterparty: z.string().max(L.COUNTERPARTY).optional(),
    amountCents: AmountCents.optional(),
    currency: Currency.optional(),
    subjectHint: z.string().max(L.SUBJECT_HINT).optional(),
    /** When the agent says it acted, read at `claimedAtPrecision`. */
    claimedAt: IsoTs,
    claimedAtPrecision: ClaimPrecision,
    /**
     * §4.1: `day` precision only, in `(claimedAt, start(day, t) + 25 h]`. Adapters set it to the next local
     * midnight, because a local day on a DST change is 23 or 25 hours long.
     */
    claimedAtEnd: IsoTs.optional(),
    /** The claimed event start of a calendar claim (§4.1); a calendar claim without it is graded `no_target`. */
    targetAt: IsoTs.optional(),
    /** When Attest read the claim. */
    observedAt: IsoTs,
    sourceKind: SourceKind,
    extractor: z.strictObject({
      id: z.string().max(L.ID),
      version: z.string().max(L.ID),
      confidence: UnitInterval,
    }),
    rawHash: Sha256,
  })
  .superRefine(refineWith(claimProblems));

// ── Evidence side ───────────────────────────────────────────────────────────────────────────────

/** Derived facts only; redact.ts applies the allowlist (Hard Rule 2). `id` = `idFromHash(contentHash)` (§10). */
export const Observation = z
  .strictObject({
    id: Ulid,
    source: ObservationSource,
    type: ActionType,
    counterparty: z.string().max(L.COUNTERPARTY).optional(),
    merchant: z.string().max(L.MERCHANT).optional(),
    amountCents: AmountCents.optional(),
    currency: Currency.optional(),
    subjectHint: z.string().max(L.SUBJECT_HINT).optional(),
    occurredAt: IsoTs,
    observedAt: IsoTs,
    /** SHA-256 of the vendor's own row id, so two identical rows stay two observations (§10). */
    rowKeyHash: Sha256.optional(),
    contentHash: Sha256,
  })
  .superRefine(refineWith(observationProblems));

/** What one observer pass could see (§3). Exists only for a pass whose health() was OK (Hard Rules 5, 6). */
export const ObserverCoverage = z
  .strictObject({
    observerId: Id,
    source: ObservationSource,
    lastSyncAt: IsoTs,
    windowStart: IsoTs,
    windowEnd: IsoTs,
    /** SHA-256 of the account identifier; never the identifier itself. */
    accountHash: Sha256.optional(),
    /** gcal.event only: true iff every calendar was visible. */
    allCalendars: z.boolean().optional(),
  })
  .superRefine(refineWith(coverageProblems));

export const Coverage = z.strictObject({
  evaluatedAt: IsoTs,
  observers: z.array(ObserverCoverage).max(L.GRADING_INPUT),
});

/** The latest health of one adapter or observer (Hard Rule 6: DEGRADED is stored and shown). */
export const HealthReport = z.strictObject({
  adapterId: Id,
  version: Id,
  status: z.enum(['OK', 'DEGRADED']),
  reasons: z.array(z.string().max(L.ITEM)).max(L.REASONS),
  checkedAt: IsoTs,
});

// ── The user's declaration ──────────────────────────────────────────────────────────────────────

export const Grant = z
  .strictObject({
    agent: AgentId,
    allowedTypes: z.array(ActionType).max(ActionType.options.length),
    /** Domains or exact addresses. */
    counterpartyAllowlist: z.array(z.string().max(L.COUNTERPARTY)).max(L.LIST),
    spendCeilingCents: AmountCents.nullable(),
    /** Required when `spendCeilingCents` is set (§6.1). */
    spendCurrency: Currency.optional(),
    /** What the user says the agent may access. */
    declaredScopes: z.array(z.string().max(L.ITEM)).max(L.LIST),
    /** What the vendor settings page shows. */
    observedScopes: z.array(z.string().max(L.ITEM)).max(L.LIST).optional(),
    /** The account hashes that belong to this agent, per source (§6.1). */
    accounts: z.partialRecord(ObservationSource, z.array(Sha256).max(L.ACCOUNTS)).optional(),
    updatedAt: IsoTs,
  })
  .refine((grant) => grant.spendCeilingCents === null || grant.spendCurrency !== undefined, {
    path: ['spendCurrency'],
    message: 'required when spendCeilingCents is set',
  });

// ── Receipts ────────────────────────────────────────────────────────────────────────────────────

/** The schema of each kind of reason param (§15): ids, hashes, enum values and integers, nothing else. */
const PARAM_KIND_SCHEMAS: Readonly<Record<ReasonParamKind, z.ZodType>> = {
  ulid: Ulid,
  sha256: Sha256,
  'source?': ObservationSource.optional(),
  actionType: ActionType,
  agent: AgentId,
  overrideGrade: OverrideGrade,
  cents: AmountCents,
  /** A sum of capped amounts, like GradeContext.priorSpendCents: not itself capped at 10^12. */
  priorSpend: z.number().int().min(0),
  currency: Currency,
};

/** The strict params schema of each ReasonCode (§15, closed): a code with no params accepts only `{}`. */
export const ReasonParams: ReadonlyMap<ReasonCode, z.ZodType> = new Map(
  ReasonCode.options.map((code) => [
    code,
    z.strictObject(
      Object.fromEntries(
        Object.entries(REASON_PARAM_KINDS[code]).map(([param, kind]) => [param, PARAM_KIND_SCHEMAS[kind]]),
      ),
    ),
  ]),
);

/**
 * `params` are exactly the ones §15 lists for `code`, so a reason can never carry an address, a name, a
 * subject or a formatted local time (§6.4, Hard Rules 2 and 10); the UI renders the words.
 */
export const Reason = z
  .strictObject({ code: ReasonCode, params: z.record(Key, z.union([z.string(), z.number()])) })
  .superRefine(refineReasonParams((code) => ReasonParams.get(code)));

/** A user override sits beside the computed grade and never replaces it (§8). */
export const ReceiptOverride = z.strictObject({
  grade: OverrideGrade,
  /** Required and non-empty in substance (§8): blank or invisible-only text is no reason. */
  reason: z.string().max(L.ITEM).regex(VISIBLE, 'must not be blank'),
  at: IsoTs,
  previousState: z.enum(['PENDING', 'FINAL']),
});

/** Invariants (schema-checks): override iff USER_OVERRIDDEN; finalAt iff FINAL; UNASKED iff 'likely', no claim. */
export const Receipt = z
  .strictObject({
    id: Ulid,
    agent: AgentId,
    /** Absent for UNASKED and scope-diff receipts. */
    claimId: Ulid.optional(),
    observationIds: z.array(Ulid).max(L.BATCH),
    requestId: Ulid.optional(),
    /** UNVERIFIABLE is the placeholder while the rule outcome is PENDING (§2). */
    grade: Grade,
    confidence: UnitInterval,
    ruleId: RuleId,
    reasons: z.array(Reason).max(L.REASONS),
    /** Display numbers, keyed by §5.1 feature name or `score`; never compared (§5.3). */
    signals: z.record(Key, z.number()).superRefine(refineWith(signalProblems)),
    state: ReceiptState,
    policyHash: Sha256,
    inputsHash: Sha256,
    /** Hard Rule 7: every UNASKED receipt says "likely", and only UNASKED receipts carry it. */
    attribution: z.literal('likely').optional(),
    override: ReceiptOverride.optional(),
    supersededBy: Ulid.optional(),
    computedAt: IsoTs,
    finalAt: IsoTs.optional(),
  })
  .superRefine(refineWith(receiptProblems));

// ── Grading inputs (§3, §7) ─────────────────────────────────────────────────────────────────────

/** UNASKED attribution for one agent: an exact score in basis points and the signals that fired. */
export const Attribution = z
  .strictObject({
    agent: AgentId,
    scoreBp: z.number().int().min(0).max(BASIS_POINTS),
    signals: z.array(UnaskedSignal).min(1).max(UnaskedSignal.options.length),
    /** The attributed agent's latest adapter sync (decides UNASKED finality). */
    adapterLastSyncAt: IsoTs.optional(),
  })
  .superRefine(refineWith(attributionProblems));

/** The sixth grade() input, hashed with the others (§3, §14.1). */
export const GradeContext = z.strictObject({
  priorSpendCents: z.number().int().min(0),
  attribution: Attribution.optional(),
  /** Claim-less scope-diff receipts only: the observed scope under test. */
  scope: z.strictObject({ observed: z.string().min(1).max(L.ITEM) }).optional(),
});

const AgentAt = z.strictObject({ agent: AgentId, at: IsoTs });
const IdleInterval = z.strictObject({ from: IsoTs, to: IsoTs }).superRefine(refineWith(intervalProblems));
const ActivityEntry = z.strictObject({ agent: AgentId, at: IsoTs, type: ActionType.optional() });
const AdapterSync = z.strictObject({ agent: AgentId, lastSyncAt: IsoTs });

/** Allowlisted activity for attribution (§7). Missing data never counts as idle. */
export const Activity = z.strictObject({
  sessions: z.array(AgentAt).max(L.GRADING_INPUT),
  idle: z.array(IdleInterval).max(L.GRADING_INPUT),
  entries: z.array(ActivityEntry).max(L.GRADING_INPUT),
  adapterSyncs: z.array(AdapterSync).max(L.GRADING_INPUT),
  claims: z.array(Claim).max(L.GRADING_INPUT),
});

// ── Types (outputs are branded; `*Input` is what a parse accepts) ───────────────────────────────

export type Ulid = z.infer<typeof Ulid>;
export type Sha256 = z.infer<typeof Sha256>;
export type IsoTs = z.infer<typeof IsoTs>;
export type Currency = z.infer<typeof Currency>;
export type RuleId = z.infer<typeof RuleId>;
export type AgentId = z.infer<typeof AgentId>;
export type ActionType = z.infer<typeof ActionType>;
export type ObservationSource = z.infer<typeof ObservationSource>;
export type ClaimPrecision = z.infer<typeof ClaimPrecision>;
export type SourceKind = z.infer<typeof SourceKind>;
export type Grade = z.infer<typeof Grade>;
export type OverrideGrade = z.infer<typeof OverrideGrade>;
export type MatchFeature = z.infer<typeof MatchFeature>;
export type ReceiptSignal = z.infer<typeof ReceiptSignal>;
export type ReceiptState = z.infer<typeof ReceiptState>;
export type UnaskedSignal = z.infer<typeof UnaskedSignal>;
export type ReasonCode = z.infer<typeof ReasonCode>;
export type Request = z.infer<typeof Request>;
export type Claim = z.infer<typeof Claim>;
export type Observation = z.infer<typeof Observation>;
export type ObserverCoverage = z.infer<typeof ObserverCoverage>;
export type Coverage = z.infer<typeof Coverage>;
export type HealthReport = z.infer<typeof HealthReport>;
export type Grant = z.infer<typeof Grant>;
export type Reason = z.infer<typeof Reason>;
export type ReceiptOverride = z.infer<typeof ReceiptOverride>;
export type Receipt = z.infer<typeof Receipt>;
export type Attribution = z.infer<typeof Attribution>;
export type GradeContext = z.infer<typeof GradeContext>;
export type Activity = z.infer<typeof Activity>;

export type RequestInput = z.input<typeof Request>;
export type ClaimInput = z.input<typeof Claim>;
export type ObservationInput = z.input<typeof Observation>;
export type ObserverCoverageInput = z.input<typeof ObserverCoverage>;
export type CoverageInput = z.input<typeof Coverage>;
export type HealthReportInput = z.input<typeof HealthReport>;
export type GrantInput = z.input<typeof Grant>;
export type ReasonInput = z.input<typeof Reason>;
export type ReceiptInput = z.input<typeof Receipt>;
export type AttributionInput = z.input<typeof Attribution>;
export type GradeContextInput = z.input<typeof GradeContext>;
export type ActivityInput = z.input<typeof Activity>;
