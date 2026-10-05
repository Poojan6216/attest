/**
 * The golden scenario file format (docs/grading.md §15), as a strict Zod schema. Every scenario file in
 * tests/golden/NN-slug.json must parse with `Scenario`; unknown keys are rejected at every level, so a
 * typo in a hand-written file fails loudly instead of silently testing nothing.
 *
 * These enums are written from the contract (§2, §7, §12, §15), not imported from src/core: the golden
 * suite is the independent statement of what the core must do. scenarios.spec.ts checks that they agree
 * with src/core/schema.ts once it exists.
 */
import { z } from 'zod';

/** §15 ReasonCode table, in table order (the order receipts list codes within a group). */
export const REASON_CODES = [
  'match.best',
  'match.none',
  'cp.plus_tag',
  'cp.confusable',
  'cp.non_ascii',
  'claim.too_vague',
  'claim.no_target',
  'coverage.none',
  'coverage.partial',
  'coverage.account_unbound',
  'coverage.calendars_hidden',
  'coverage.changes_unfollowed',
  'coverage.change_unprovable',
  'coverage.account_partial',
  'coverage.multiple_accounts',
  'coverage.no_account',
  'coverage.no_parser',
  'coverage.never_completed',
  'grace.waiting',
  'scope.type_not_allowed',
  'scope.counterparty_not_allowed',
  'allowlist.unchecked',
  'ceiling.exceeded',
  'ceiling.cumulative_exceeded',
  'ceiling.currency_mismatch',
  'scope.observed_not_declared',
  'unasked.session',
  'unasked.idle',
  'unasked.signature',
  'unasked.adjacent',
  'override.user',
  'superseded',
] as const;

export const ReasonCode = z.enum(REASON_CODES);
export type ReasonCode = z.infer<typeof ReasonCode>;

/**
 * What one reason param holds (§15 "Params per code (closed)"). Ids are written in scenario files as refs
 * (`o1`, `c1`) and resolved by the loader; a `scopeHash` is written as the observed scope itself and the
 * loader stores `sha256Hex(scope)` (§15 v1.3), so no hash is typed by hand; everything else is written as the
 * value itself.
 */
export type ParamKind =
  | 'observationRef'
  | 'claimRef'
  | 'source'
  | 'actionType'
  | 'cents'
  | 'currency'
  | 'scopeHash'
  | 'agent'
  | 'grade';

const NO_PARAMS = {} as const;
const SOURCE = { source: 'source' } as const;
const AGENT = { agent: 'agent' } as const;

/** §15 (v1.4) params per code, written from the contract. `source` is omitted for a type with no sources. */
export const REASON_PARAMS: Readonly<Record<ReasonCode, Readonly<Record<string, ParamKind>>>> = {
  'match.best': { observationId: 'observationRef' },
  'match.none': NO_PARAMS,
  'cp.plus_tag': NO_PARAMS,
  'cp.confusable': NO_PARAMS,
  'cp.non_ascii': NO_PARAMS,
  'claim.too_vague': NO_PARAMS,
  'claim.no_target': NO_PARAMS,
  'coverage.none': SOURCE,
  'coverage.partial': SOURCE,
  'coverage.account_unbound': SOURCE,
  'coverage.calendars_hidden': SOURCE,
  'coverage.changes_unfollowed': SOURCE,
  'coverage.change_unprovable': SOURCE,
  'coverage.account_partial': SOURCE,
  'coverage.multiple_accounts': SOURCE,
  'coverage.no_account': SOURCE,
  // §15 v1.4: coverage.no_parser carries {source} like the other coverage caps.
  'coverage.no_parser': SOURCE,
  'coverage.never_completed': NO_PARAMS,
  'grace.waiting': SOURCE,
  'scope.type_not_allowed': { type: 'actionType' },
  'scope.counterparty_not_allowed': NO_PARAMS,
  'allowlist.unchecked': NO_PARAMS,
  'ceiling.exceeded': { amountCents: 'cents', ceilingCents: 'cents' },
  'ceiling.cumulative_exceeded': { priorSpendCents: 'cents', amountCents: 'cents', ceilingCents: 'cents' },
  'ceiling.currency_mismatch': { currency: 'currency', spendCurrency: 'currency' },
  'scope.observed_not_declared': { scopeHash: 'scopeHash' },
  'unasked.session': AGENT,
  'unasked.idle': AGENT,
  'unasked.signature': AGENT,
  'unasked.adjacent': AGENT,
  'override.user': { grade: 'grade' },
  superseded: { claimId: 'claimRef' },
};

/** A param value as written in a scenario file: a ref, an enum value, a code, a hash, or an integer. */
const ParamValue = z.union([z.string().min(1).max(64), z.number().int().min(0)]);
const ParamName = z.string().regex(/^[a-z][A-Za-z]*$/, 'param names are camelCase identifiers');
export const ReasonParamsByCode = z.partialRecord(ReasonCode, z.record(ParamName, ParamValue));
export type ReasonParamsByCode = z.infer<typeof ReasonParamsByCode>;

export const AGENT_IDS = ['muse', 'chatgpt', 'dots', 'claude'] as const;
export const AgentId = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentId>;

export const ACTION_TYPES = [
  'email.sent',
  'calendar.created',
  'calendar.updated',
  'calendar.deleted',
  'purchase.made',
  'subscription.changed',
  'listing.posted',
  'message.sent',
  'other',
] as const;
export const ActionType = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionType>;

export const OBSERVATION_SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
export const ObservationSource = z.enum(OBSERVATION_SOURCES);
export type ObservationSource = z.infer<typeof ObservationSource>;

export const GRADES = ['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNASKED', 'OVER_SCOPE', 'UNVERIFIABLE'] as const;
export const Grade = z.enum(GRADES);
export type Grade = z.infer<typeof Grade>;

export const RECEIPT_STATES = ['PENDING', 'FINAL', 'USER_OVERRIDDEN'] as const;
export const ReceiptState = z.enum(RECEIPT_STATES);
export type ReceiptState = z.infer<typeof ReceiptState>;

export const ClaimPrecision = z.enum(['minute', 'hour', 'day']);
export type ClaimPrecision = z.infer<typeof ClaimPrecision>;

const SourceKind = z.enum(['activity_view', 'chat', 'notification', 'settings']);
const OverrideGrade = z.enum(['VERIFIED', 'NOT_FOUND']);

/** ISO 8601 with seconds and an explicit offset (`Z` or `±hh:mm`), as every IsoTs in the contract. */
export const IsoTs = z.iso.datetime({ offset: true });

export const ClaimRef = z.string().regex(/^c\d+$/, 'claim refs are c<n>');
export const GrantRef = z.string().regex(/^g\d+$/, 'grant refs are g<n>');
export const ObservationRef = z.string().regex(/^o\d+$/, 'observation refs are o<n>');
const Ref = z.union([ClaimRef, ObservationRef]);

/** A label the loader turns into a SHA-256 (account hashes, vendor row keys): never typed as a hash. */
const Label = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'labels are short lowercase slugs');

const FRACTION = /^(0|[1-9]\d*)\/[1-9]\d*$/;

/** An exact score: a reduced fraction "p/q" in [0, 1]; "1/1" and "0/1" for the ends. */
export const Fraction = z
  .string()
  .refine((text) => FRACTION.test(text) && isReducedUnitFraction(text), 'scores are reduced "p/q" in [0, 1]');

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

export function parseFraction(text: string): { num: bigint; den: bigint } {
  const [num = '', den = ''] = text.split('/');
  return { num: BigInt(num), den: BigInt(den) };
}

function isReducedUnitFraction(text: string): boolean {
  const { num, den } = parseFraction(text);
  return num <= den && gcd(num, den) === 1n;
}

const Notes = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const ScenarioClaim = z.strictObject({
  ref: ClaimRef,
  agent: AgentId,
  type: ActionType,
  counterparty: z.string().min(1).max(320).optional(),
  amountCents: z.number().int().min(0).max(1e12).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  subjectHint: z.string().min(1).max(80).optional(),
  claimedAt: IsoTs,
  claimedAtPrecision: ClaimPrecision.optional(),
  /** The end of the precision unit (§4.1, v1.2): the next local midnight for a day on a DST change. */
  claimedAtEnd: IsoTs.optional(),
  targetAt: IsoTs.optional(),
  observedAt: IsoTs.optional(),
  sourceKind: SourceKind.optional(),
  /** The normalised claim text that feeds rawHash (§10); defaults to the ref. */
  text: z.string().min(1).max(200).optional(),
  /** Label for the vendor's own row id; the loader hashes it into rawHash (§10). */
  rowKey: Label.optional(),
});
export type ScenarioClaim = z.infer<typeof ScenarioClaim>;

export const ScenarioObservation = z.strictObject({
  ref: ObservationRef,
  source: ObservationSource,
  type: ActionType,
  counterparty: z.string().min(1).max(320).optional(),
  merchant: z.string().min(1).max(120).optional(),
  amountCents: z.number().int().min(0).max(1e12).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  subjectHint: z.string().min(1).max(80).optional(),
  occurredAt: IsoTs,
  observedAt: IsoTs.optional(),
  /** Label for the vendor's own row id; the loader stores SHA-256(label) as rowKeyHash (§10). */
  rowKey: Label.optional(),
});
export type ScenarioObservation = z.infer<typeof ScenarioObservation>;

export const ScenarioGrant = z.strictObject({
  /** Optional, so an expectation's `inputs.grant` can name the grant in force (§3 v1.4). */
  ref: GrantRef.optional(),
  agent: AgentId,
  allowedTypes: z.array(ActionType).optional(),
  counterpartyAllowlist: z.array(z.string().min(1).max(320)).optional(),
  spendCeilingCents: z.number().int().min(0).nullable().optional(),
  spendCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  declaredScopes: z.array(z.string().min(1).max(120)).optional(),
  observedScopes: z.array(z.string().min(1).max(120)).optional(),
  accounts: z.partialRecord(ObservationSource, z.array(Label).min(1)).optional(),
  /** When the grant took effect (§3 v1.4: the latest `updatedAt ≤ evaluatedAt` is in force). */
  updatedAt: IsoTs.optional(),
});
export type ScenarioGrant = z.infer<typeof ScenarioGrant>;

export const ScenarioCoverage = z.strictObject({
  observerId: z.string().min(1).max(64).optional(),
  source: ObservationSource,
  lastSyncAt: IsoTs,
  windowStart: IsoTs,
  windowEnd: IsoTs,
  accountHash: Label.optional(),
  allCalendars: z.boolean().optional(),
  /** §3 v1.9: gcal.event only, since when the window's changes were followed (the ledger sets it). */
  changesSince: IsoTs.optional(),
});
export type ScenarioCoverage = z.infer<typeof ScenarioCoverage>;

export const ScenarioActivity = z.strictObject({
  sessions: z.array(z.strictObject({ agent: AgentId, at: IsoTs })).optional(),
  idle: z.array(z.strictObject({ from: IsoTs, to: IsoTs })).optional(),
  entries: z.array(z.strictObject({ agent: AgentId, at: IsoTs, type: ActionType.optional() })).optional(),
  adapterSyncs: z.array(z.strictObject({ agent: AgentId, lastSyncAt: IsoTs })).optional(),
  /** Claims the attribution pass may see (§7 Activity.claims); defaults to every claim in the scenario. */
  claims: z.array(ClaimRef).optional(),
});
export type ScenarioActivity = z.infer<typeof ScenarioActivity>;

/** A FINAL or USER_OVERRIDDEN pre-assignment (§4.3). `claim: null` is an overridden UNASKED receipt. */
export const FixedPair = z.strictObject({ claim: ClaimRef.nullable(), observation: ObservationRef });

/** mode "grade": the single grade() call (§3). Claim-less calls name the agent whose grant applies. */
export const GradeCall = z.strictObject({
  claim: ClaimRef.nullable(),
  candidates: z.array(ObservationRef),
  agent: AgentId.optional(),
  priorSpendCents: z.number().int().min(0).optional(),
  scope: z.string().min(1).max(120).optional(),
});
export type GradeCall = z.infer<typeof GradeCall>;

/** v1.4: an illegal event (§8); `transition` must throw IllegalTransitionError and nothing changes. */
const Rejected = z.literal(true).optional();

/**
 * State events applied with state.ts `transition` after grading, in order (§8). `regrade` (batch mode, v1.4)
 * re-grades the same inputs at `evaluatedAt` and installs the subject's new receipt; `deleted: true`: the new
 * grading has none, so the caller deletes the PENDING UNASKED receipt (§7, §8).
 */
export const ScenarioEvent = z.discriminatedUnion('event', [
  z.strictObject({
    event: z.literal('override'),
    ref: Ref,
    grade: OverrideGrade,
    reason: z.string().min(1).max(120),
    at: IsoTs,
    rejected: Rejected,
  }),
  z.strictObject({ event: z.literal('supersede'), ref: ObservationRef, claim: ClaimRef, rejected: Rejected }),
  z.strictObject({
    event: z.literal('regrade'),
    ref: Ref,
    evaluatedAt: IsoTs,
    deleted: z.literal(true).optional(),
    rejected: Rejected,
  }),
]);
export type ScenarioEvent = z.infer<typeof ScenarioEvent>;

const ScopeSubject = z.strictObject({ agent: AgentId, scope: z.string().min(1).max(120) });

/** Stated parts of gradeBatch's `inputs` (§3 v1.4): grant in force, `priorSpendCents`, `scope.observed`. */
export const ExpectedInputs = z.strictObject({
  grant: GrantRef.optional(),
  priorSpendCents: z.number().int().min(0).optional(),
  scope: z.string().min(1).max(120).optional(),
});
export type ExpectedInputs = z.infer<typeof ExpectedInputs>;

export const ExpectedReceipt = z
  .strictObject({
    ref: Ref.optional(),
    scope: ScopeSubject.optional(),
    grade: Grade,
    ruleId: z.string().min(1).max(64),
    state: ReceiptState,
    observationRefs: z.array(ObservationRef),
    score: Fraction.nullable(),
    reasonCodes: z.array(ReasonCode),
    /**
     * Optional: the params of every reason (§15 closed table), keyed by code. When present it names exactly
     * the codes in `reasonCodes`, and the runner compares the receipt's reasons `{code, params}` exactly.
     */
    reasonParams: ReasonParamsByCode.optional(),
    agent: AgentId.optional(),
    attributionScore: Fraction.optional(),
    override: OverrideGrade.optional(),
    previousState: z.enum(['PENDING', 'FINAL']).optional(),
    supersededBy: ClaimRef.optional(),
    /** Batch mode only: the inputs gradeBatch returned with this receipt (§3 v1.4). */
    inputs: ExpectedInputs.optional(),
  })
  .refine((e) => (e.ref === undefined) !== (e.scope === undefined), 'name exactly one of ref or scope');
export type ExpectedReceipt = z.infer<typeof ExpectedReceipt>;

const ScenarioInput = z.strictObject({
  evaluatedAt: IsoTs,
  claims: z.array(ScenarioClaim),
  observations: z.array(ScenarioObservation),
  grants: z.array(ScenarioGrant).min(1),
  coverage: z.array(ScenarioCoverage),
  activity: ScenarioActivity.optional(),
  fixed: z.array(FixedPair).optional(),
  grade: GradeCall.optional(),
});
export type ScenarioInput = z.infer<typeof ScenarioInput>;

/** Assertions about loader-built ids that an expectation depends on (tie-breaks by id, dedupe by hash). */
const AssertIds = z.strictObject({
  equal: z.array(z.tuple([Ref, Ref])).optional(),
  ascending: z.array(z.tuple([Ref, Ref])).optional(),
});

export const Scenario = z
  .strictObject({
    name: z.string().min(1).max(120),
    covers: z.array(z.string().regex(/^[a-z_]+:[^\s]+$/, 'covers tags are "<kind>:<id>"')).min(1),
    mode: z.enum(['batch', 'grade']),
    policyPatch: z.record(z.string(), z.json()).optional(),
    notes: Notes.optional(),
    input: ScenarioInput,
    events: z.array(ScenarioEvent).optional(),
    assertIds: AssertIds.optional(),
    expect: z.array(ExpectedReceipt),
  })
  .refine((s) => (s.mode === 'grade') === (s.input.grade !== undefined), {
    message: 'mode "grade" needs input.grade; mode "batch" must not have it',
    path: ['input', 'grade'],
  })
  .refine((s) => s.mode === 'batch' || s.input.fixed === undefined, {
    message: 'fixed pre-assignments are a gradeBatch input',
    path: ['input', 'fixed'],
  })
  .refine((s) => s.mode === 'batch' || !(s.events ?? []).some((event) => event.event === 'regrade'), {
    message: 'regrade events re-run gradeBatch',
    path: ['events'],
  })
  .refine((s) => s.mode === 'batch' || s.expect.every((e) => e.inputs === undefined), {
    message: 'expected inputs are what gradeBatch returns',
    path: ['expect'],
  });
export type Scenario = z.infer<typeof Scenario>;
