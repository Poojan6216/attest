/**
 * The canonical schemas (docs/grading.md §3, §7, §13, §15; build_spec §7 with the §14 deviations). Every object is
 * strict: an unknown key is an error, so nothing outside the allowlist reaches storage, the bus or a hash (Hard
 * Rule 2). Every free-text string and every array is capped, and ids, hashes and timestamps are branded (both in
 * ./schema-primitives, re-exported here). Counterparty, merchant, subject,
 * allowlist and scope text is one line (SEC-3); component ids, versions, health reasons and a vendor's conversation
 * id are tokens (OBS-1; all in ./schema-text). Cross-field invariants live in ./schema-checks. src/ledger/types.ts
 * re-exports all of this. PURE: no I/O, no clock, no locale (Hard Rule 4).
 */
import { z } from 'zod';

import {
  attributionProblems,
  claimProblems,
  coverageProblems,
  intervalProblems,
  observationProblems,
  REASON_PARAM_KINDS,
  type ReasonParamKind,
  refineReasonParams,
  refineWith,
  signalProblems,
} from './schema-checks';
import {
  ActionType,
  AgentId,
  ClaimPrecision,
  Grade,
  ObservationSource,
  OverrideGrade,
  ReasonCode,
  ReceiptState,
  SourceKind,
  UnaskedSignal,
} from './schema-enums';
import {
  AmountCents,
  ComponentId,
  Currency,
  IsoTs,
  Key,
  RuleId,
  SCHEMA_LIMITS,
  Sha256,
  Ulid,
  UnitInterval,
} from './schema-primitives';
import { receiptProblems, revertedOverrides } from './schema-receipt';
import { healthReason, oneLineText, vendorId, VISIBLE } from './schema-text';
import { BASIS_POINTS } from './units';

const L = SCHEMA_LIMITS;

/** Length caps and the branded primitives (ids, hashes, timestamps, amounts, currencies): ./schema-primitives. */
export {
  AmountCents,
  ComponentId,
  Currency,
  IsoTs,
  RuleId,
  SCHEMA_LIMITS,
  Sha256,
  Ulid,
} from './schema-primitives';

/** The closed sets (agents, actions, sources, grades, states, reasons, signals): ./schema-enums, re-exported whole. */
export * from './schema-enums';

// ── Agent side ──────────────────────────────────────────────────────────────────────────────────

export const Request = z.strictObject({
  id: Ulid,
  agent: AgentId,
  conversationId: vendorId(L.CONVERSATION_ID),
  textHint: z.string().max(L.TEXT_HINT),
  textHash: Sha256,
  ts: IsoTs,
});

export const Claim = z
  .strictObject({
    id: Ulid, // = idFromHash(rawHash) (§10), checked in claimProblems
    agent: AgentId,
    requestId: Ulid.optional(),
    type: ActionType,
    counterparty: oneLineText(L.COUNTERPARTY).optional(),
    amountCents: AmountCents.optional(),
    currency: Currency.optional(),
    subjectHint: oneLineText(L.SUBJECT_HINT).optional(),
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
    extractor: z.strictObject({ id: ComponentId, version: ComponentId, confidence: UnitInterval }),
    rawHash: Sha256,
  })
  .superRefine(refineWith(claimProblems));

// ── Evidence side ───────────────────────────────────────────────────────────────────────────────

/** Derived facts only: redact.ts projects them, the ledger re-checks them (Hard Rule 2). `id` per §10. */
export const Observation = z
  .strictObject({
    id: Ulid,
    source: ObservationSource,
    type: ActionType,
    counterparty: oneLineText(L.COUNTERPARTY).optional(),
    merchant: oneLineText(L.MERCHANT).optional(),
    amountCents: AmountCents.optional(),
    currency: Currency.optional(),
    subjectHint: oneLineText(L.SUBJECT_HINT).optional(),
    occurredAt: IsoTs,
    observedAt: IsoTs,
    sightedAt: IsoTs.optional(), // the ledger's: the sighting, when it stored the row later (§3, §4.1)
    /** SHA-256 of the vendor's own row id, so two identical rows stay two observations (§10). */
    rowKeyHash: Sha256.optional(),
    contentHash: Sha256,
  })
  .superRefine(refineWith(observationProblems));

/** What one observer pass could see (§3). Exists only for a pass whose health() was OK (Hard Rules 5, 6). */
export const ObserverCoverage = z
  .strictObject({
    observerId: ComponentId,
    source: ObservationSource,
    lastSyncAt: IsoTs,
    windowStart: IsoTs,
    windowEnd: IsoTs,
    /** SHA-256 of the account identifier; never the identifier itself. */
    accountHash: Sha256.optional(),
    /** gcal.event only (§3): every calendar was visible; since when changes were followed (set by the ledger). */
    allCalendars: z.boolean().optional(),
    changesSince: IsoTs.optional(),
  })
  .superRefine(refineWith(coverageProblems));

/** A span, `from` ≤ `to`: an idle interval (§7), or what a clock repair found stamped ahead (`repairs`, §3 v1.16). */
const Interval = z.strictObject({ from: IsoTs, to: IsoTs }).superRefine(refineWith(intervalProblems));

export const Coverage = z.strictObject({
  evaluatedAt: IsoTs,
  observers: z.array(ObserverCoverage).max(L.GRADING_INPUT),
  repairs: z.array(Interval).max(L.LIST).optional(),
});

/** The latest health of an adapter or observer (Hard Rule 6). IDLE: a page it does not read (sprint_2 2.11). */
export const HealthReport = z.strictObject({
  adapterId: ComponentId,
  version: ComponentId,
  status: z.enum(['OK', 'IDLE', 'DEGRADED']),
  /** Reason codes (`not_sent_folder`), never text the page held: health runs beside the mail (Hard Rule 2). */
  reasons: z.array(healthReason(L.ID)).max(L.REASONS),
  checkedAt: IsoTs,
});

// ── The user's declaration ──────────────────────────────────────────────────────────────────────

/** A spend ceiling needs its currency (§6.1): the rule of a grant, and of a person's choices for one. */
const ceilingHasCurrency = (grant: {
  spendCeilingCents: number | null;
  spendCurrency?: string | undefined;
}) => grant.spendCeilingCents === null || grant.spendCurrency !== undefined;
const CEILING_NEEDS_CURRENCY = { path: ['spendCurrency'], message: 'required when spendCeilingCents is set' };

export const Grant = z
  .strictObject({
    agent: AgentId,
    allowedTypes: z.array(ActionType).max(ActionType.options.length),
    /** Domains or exact addresses. */
    counterpartyAllowlist: z.array(oneLineText(L.COUNTERPARTY)).max(L.LIST),
    spendCeilingCents: AmountCents.nullable(),
    /** Required when `spendCeilingCents` is set (§6.1). */
    spendCurrency: Currency.optional(),
    /** What the user says the agent may access. */
    declaredScopes: z.array(oneLineText(L.ITEM)).max(L.LIST),
    /** What the vendor settings page shows. */
    observedScopes: z.array(oneLineText(L.ITEM)).max(L.LIST).optional(),
    /** The account hashes that belong to this agent, per source (§6.1). */
    accounts: z.partialRecord(ObservationSource, z.array(Sha256).max(L.ACCOUNTS)).optional(),
    updatedAt: IsoTs,
  })
  .refine(ceilingHasCurrency, CEILING_NEEDS_CURRENCY);

const { agent, allowedTypes, counterpartyAllowlist, spendCeilingCents, spendCurrency, declaredScopes } =
  Grant.shape;

/**
 * What a person chooses of one agent's grant (sprint_4 4.4): the fields they declare, with the grant's rule across them.
 * Never what Attest observed (`observedScopes`, `accounts`) nor the stamp, which the service worker keeps from the
 * stored grant and stamps itself (src/ledger/grant-save.ts). The one definition the options page, the bus and the
 * ledger share (sprint_4 close, tech review TECH-8).
 */
export const GrantChoices = z
  .strictObject({
    agent,
    allowedTypes,
    counterpartyAllowlist,
    spendCeilingCents,
    spendCurrency,
    declaredScopes,
  })
  .refine(ceilingHasCurrency, CEILING_NEEDS_CURRENCY);

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

/** Invariants (schema-receipt.ts, §8): override, finalAt, finalFrom, UNASKED, override.at ≥ computedAt, lifecycle reasons. */
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
    reverted: revertedOverrides(OverrideGrade, IsoTs, Ulid, L).optional(),
    supersededBy: Ulid.optional(),
    computedAt: IsoTs,
    finalAt: IsoTs.optional(),
    finalFrom: IsoTs.optional(), // §8 v1.18: while PENDING, the earliest instant a grading can make it FINAL
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

/** The advisory model's score of one candidate, in basis points (§5.4, v1.19: it proposes, `grade()` decides). */
export const ModelScore = z.strictObject({
  observationId: Ulid,
  score: z.number().int().min(0).max(BASIS_POINTS),
});
const inIdOrder = (scores: readonly { observationId: string }[]): boolean =>
  scores.every((score, i) => i === 0 || (scores[i - 1]?.observationId ?? '') < score.observationId);

/** A claim's model scores, at most one per candidate, in id order, so equal sets hash alike (§5.4, v1.19). */
export const ModelScores = z
  .array(ModelScore)
  .max(L.BATCH)
  .refine(inIdOrder, 'one per observation, in id order');

/** The sixth grade() input, hashed with the others (§3, §14.1). */
export const GradeContext = z.strictObject({
  priorSpendCents: z.number().int().min(0),
  attribution: Attribution.optional(),
  /** Claim-less scope-diff receipts only: the observed scope under test. */
  scope: z.strictObject({ observed: oneLineText(L.ITEM).min(1) }).optional(),
  /** A claim's model scores (`ModelScores`). */
  modelScores: ModelScores.optional(),
});

const AgentAt = z.strictObject({ agent: AgentId, at: IsoTs });
const ActivityEntry = z.strictObject({ agent: AgentId, at: IsoTs, type: ActionType.optional() });
const AdapterSync = z.strictObject({ agent: AgentId, lastSyncAt: IsoTs });

/** Allowlisted activity for attribution (§7). Missing data never counts as idle. */
export const Activity = z.strictObject({
  sessions: z.array(AgentAt).max(L.GRADING_INPUT),
  idle: z.array(Interval).max(L.GRADING_INPUT),
  entries: z.array(ActivityEntry).max(L.GRADING_INPUT),
  adapterSyncs: z.array(AdapterSync).max(L.GRADING_INPUT),
  claims: z.array(Claim).max(L.GRADING_INPUT),
});

// ── Types (outputs are branded; `*Input` is what a parse accepts) ───────────────────────────────

export type Request = z.infer<typeof Request>;
export type Claim = z.infer<typeof Claim>;
export type Observation = z.infer<typeof Observation>;
export type ObserverCoverage = z.infer<typeof ObserverCoverage>;
export type Coverage = z.infer<typeof Coverage>;
export type HealthReport = z.infer<typeof HealthReport>;
export type Grant = z.infer<typeof Grant>;
export type GrantChoices = z.infer<typeof GrantChoices>;
export type Reason = z.infer<typeof Reason>;
export type ReceiptOverride = z.infer<typeof ReceiptOverride>;
export type Receipt = z.infer<typeof Receipt>;
export type Attribution = z.infer<typeof Attribution>;
export type ModelScores = z.infer<typeof ModelScores>;
export type GradeContext = z.infer<typeof GradeContext>;
export type Activity = z.infer<typeof Activity>;

export type RequestInput = z.input<typeof Request>;
export type ClaimInput = z.input<typeof Claim>;
export type ObservationInput = z.input<typeof Observation>;
export type ObserverCoverageInput = z.input<typeof ObserverCoverage>;
export type HealthReportInput = z.input<typeof HealthReport>;
export type GrantInput = z.input<typeof Grant>;
export type ReasonInput = z.input<typeof Reason>;
export type ReceiptInput = z.input<typeof Receipt>;
export type AttributionInput = z.input<typeof Attribution>;
export type GradeContextInput = z.input<typeof GradeContext>;
export type ActivityInput = z.input<typeof Activity>;
