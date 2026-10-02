/**
 * SCHEMA_LIMITS boundaries for the core schemas (SECURITY-4, Hard Rule 2; Decisions [0.close], task 1.0): for
 * every capped string, array, record and amount, a value at the cap parses and one over it is rejected, at
 * the capped field's path. So no email body rides in `counterparty`, and no input grows without bound.
 * Reason params need no cap of their own: §15 closes them per code (schema-reasons.spec.ts).
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { idFromHash } from '../../../src/core/hash';
import {
  Activity,
  ActionType,
  Claim,
  Coverage,
  Grant,
  GradeContext,
  HealthReport,
  IsoTs,
  Observation,
  ObserverCoverage,
  Receipt,
  ReceiptOverride,
  ReceiptSignal,
  Request,
  SCHEMA_LIMITS as L,
} from '../../../src/core/schema';

const ULID = '01JA0000000000000000000001';
const HASH = 'ef'.repeat(32);
const T = '2026-10-06T14:02:00-04:00';
const x = (n: number): string => 'x'.repeat(n);
const many = <T>(n: number, item: T): T[] => Array.from({ length: n }, () => item);
const keyed = (n: number, value: number | string): Record<string, number | string> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${String(i)}`, value]));

const REQUEST = { id: ULID, agent: 'muse', conversationId: 'c', textHint: '', textHash: HASH, ts: T };
const EXTRACTOR = { id: 'muse', version: '1', confidence: 1 };
const CLAIM = {
  id: ULID,
  agent: 'muse',
  type: 'email.sent',
  claimedAt: T,
  claimedAtPrecision: 'minute',
  observedAt: T,
  sourceKind: 'chat',
  extractor: EXTRACTOR,
  rawHash: HASH,
};
const OBSERVATION = {
  id: idFromHash(HASH),
  source: 'gmail.sent',
  type: 'email.sent',
  occurredAt: T,
  observedAt: T,
  contentHash: HASH,
};
const GRANT = {
  agent: 'muse',
  allowedTypes: [],
  counterpartyAllowlist: [],
  spendCeilingCents: null,
  declaredScopes: [],
  updatedAt: T,
};
const HEALTH = { adapterId: 'gmail', version: '1', status: 'OK', reasons: [], checkedAt: T };
const RECEIPT = {
  id: ULID,
  agent: 'muse',
  claimId: ULID,
  observationIds: [],
  grade: 'UNVERIFIABLE',
  confidence: 0,
  ruleId: 'pending',
  reasons: [],
  signals: {},
  state: 'PENDING',
  policyHash: HASH,
  inputsHash: HASH,
  computedAt: T,
};
const OVERRIDE = { grade: 'VERIFIED', reason: 'ok', at: T, previousState: 'PENDING' };
const ENTRY = { observerId: 'gmail', source: 'gmail.sent', lastSyncAt: T, windowStart: T, windowEnd: T };
const ACTIVITY = { sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [] };

/** [label, schema, build(n) → a value whose capped field has size n, cap, path of that field] */
type Case = readonly [string, z.ZodType, (n: number) => unknown, number, readonly (string | number)[]];

const CASES: readonly Case[] = [
  [
    'IsoTs (fractional digits)',
    IsoTs,
    (n) => `2026-10-06T14:02:00.${'1'.repeat(n - 26)}+05:30`,
    L.ISO_TS,
    [],
  ],
  [
    'Request.conversationId',
    Request,
    (n) => ({ ...REQUEST, conversationId: x(n) }),
    L.CONVERSATION_ID,
    ['conversationId'],
  ],
  ['Request.textHint', Request, (n) => ({ ...REQUEST, textHint: x(n) }), L.TEXT_HINT, ['textHint']],
  ['Claim.counterparty', Claim, (n) => ({ ...CLAIM, counterparty: x(n) }), L.COUNTERPARTY, ['counterparty']],
  ['Claim.subjectHint', Claim, (n) => ({ ...CLAIM, subjectHint: x(n) }), L.SUBJECT_HINT, ['subjectHint']],
  ['Claim.amountCents', Claim, (n) => ({ ...CLAIM, amountCents: n }), L.AMOUNT_CENTS, ['amountCents']],
  [
    'Claim.extractor.id',
    Claim,
    (n) => ({ ...CLAIM, extractor: { ...EXTRACTOR, id: x(n) } }),
    L.ID,
    ['extractor', 'id'],
  ],
  [
    'Claim.extractor.version',
    Claim,
    (n) => ({ ...CLAIM, extractor: { ...EXTRACTOR, version: x(n) } }),
    L.ID,
    ['extractor', 'version'],
  ],
  [
    'Observation.counterparty',
    Observation,
    (n) => ({ ...OBSERVATION, counterparty: x(n) }),
    L.COUNTERPARTY,
    ['counterparty'],
  ],
  [
    'Observation.merchant',
    Observation,
    (n) => ({ ...OBSERVATION, merchant: x(n) }),
    L.MERCHANT,
    ['merchant'],
  ],
  [
    'Observation.subjectHint',
    Observation,
    (n) => ({ ...OBSERVATION, subjectHint: x(n) }),
    L.SUBJECT_HINT,
    ['subjectHint'],
  ],
  [
    'Observation.amountCents',
    Observation,
    (n) => ({ ...OBSERVATION, amountCents: n }),
    L.AMOUNT_CENTS,
    ['amountCents'],
  ],
  [
    'Grant.allowedTypes',
    Grant,
    (n) => ({ ...GRANT, allowedTypes: many(n, 'other') }),
    ActionType.options.length,
    ['allowedTypes'],
  ],
  [
    'Grant.counterpartyAllowlist item',
    Grant,
    (n) => ({ ...GRANT, counterpartyAllowlist: [x(n)] }),
    L.COUNTERPARTY,
    ['counterpartyAllowlist', 0],
  ],
  [
    'Grant.counterpartyAllowlist',
    Grant,
    (n) => ({ ...GRANT, counterpartyAllowlist: many(n, 'a.com') }),
    L.LIST,
    ['counterpartyAllowlist'],
  ],
  [
    'Grant.declaredScopes item',
    Grant,
    (n) => ({ ...GRANT, declaredScopes: [x(n)] }),
    L.ITEM,
    ['declaredScopes', 0],
  ],
  [
    'Grant.declaredScopes',
    Grant,
    (n) => ({ ...GRANT, declaredScopes: many(n, 'mail') }),
    L.LIST,
    ['declaredScopes'],
  ],
  [
    'Grant.observedScopes item',
    Grant,
    (n) => ({ ...GRANT, observedScopes: [x(n)] }),
    L.ITEM,
    ['observedScopes', 0],
  ],
  [
    'Grant.observedScopes',
    Grant,
    (n) => ({ ...GRANT, observedScopes: many(n, 'mail') }),
    L.LIST,
    ['observedScopes'],
  ],
  [
    'Grant.accounts per source',
    Grant,
    (n) => ({ ...GRANT, accounts: { 'gmail.sent': many(n, HASH) } }),
    L.ACCOUNTS,
    ['accounts', 'gmail.sent'],
  ],
  [
    'Grant.spendCeilingCents',
    Grant,
    (n) => ({ ...GRANT, spendCeilingCents: n, spendCurrency: 'USD' }),
    L.AMOUNT_CENTS,
    ['spendCeilingCents'],
  ],
  ['HealthReport.adapterId', HealthReport, (n) => ({ ...HEALTH, adapterId: x(n) }), L.ID, ['adapterId']],
  ['HealthReport.version', HealthReport, (n) => ({ ...HEALTH, version: x(n) }), L.ID, ['version']],
  [
    'HealthReport.reasons item',
    HealthReport,
    (n) => ({ ...HEALTH, reasons: [x(n)] }),
    L.ITEM,
    ['reasons', 0],
  ],
  [
    'HealthReport.reasons',
    HealthReport,
    (n) => ({ ...HEALTH, reasons: many(n, 'r') }),
    L.REASONS,
    ['reasons'],
  ],
  ['ReceiptOverride.reason', ReceiptOverride, (n) => ({ ...OVERRIDE, reason: x(n) }), L.ITEM, ['reason']],
  ['Receipt.ruleId', Receipt, (n) => ({ ...RECEIPT, ruleId: x(n) }), L.ID, ['ruleId']],
  [
    'Receipt.observationIds',
    Receipt,
    (n) => ({ ...RECEIPT, observationIds: many(n, ULID) }),
    L.BATCH,
    ['observationIds'],
  ],
  [
    'Receipt.reasons',
    Receipt,
    (n) => ({ ...RECEIPT, reasons: many(n, { code: 'match.none', params: {} }) }),
    L.REASONS,
    ['reasons'],
  ],
  [
    'ObserverCoverage.observerId',
    ObserverCoverage,
    (n) => ({ ...ENTRY, observerId: x(n) }),
    L.ID,
    ['observerId'],
  ],
  [
    'Coverage.observers',
    Coverage,
    (n) => ({ evaluatedAt: T, observers: many(n, ENTRY) }),
    L.GRADING_INPUT,
    ['observers'],
  ],
  [
    'GradeContext.scope.observed',
    GradeContext,
    (n) => ({ priorSpendCents: 0, scope: { observed: x(n) } }),
    L.ITEM,
    ['scope', 'observed'],
  ],
  [
    'Activity.sessions',
    Activity,
    (n) => ({ ...ACTIVITY, sessions: many(n, { agent: 'muse', at: T }) }),
    L.GRADING_INPUT,
    ['sessions'],
  ],
  [
    'Activity.idle',
    Activity,
    (n) => ({ ...ACTIVITY, idle: many(n, { from: T, to: T }) }),
    L.GRADING_INPUT,
    ['idle'],
  ],
  [
    'Activity.entries',
    Activity,
    (n) => ({ ...ACTIVITY, entries: many(n, { agent: 'muse', at: T }) }),
    L.GRADING_INPUT,
    ['entries'],
  ],
  [
    'Activity.adapterSyncs',
    Activity,
    (n) => ({ ...ACTIVITY, adapterSyncs: many(n, { agent: 'muse', lastSyncAt: T }) }),
    L.GRADING_INPUT,
    ['adapterSyncs'],
  ],
  [
    'Activity.claims',
    Activity,
    (n) => ({ ...ACTIVITY, claims: many(n, CLAIM) }),
    L.GRADING_INPUT,
    ['claims'],
  ],
];

describe('core SCHEMA_LIMITS (SECURITY-4)', () => {
  it.each(CASES)(
    '%s: at the cap parses, one over is rejected at that field',
    (_label, schema, build, cap, path) => {
      expect(schema.safeParse(build(cap)).success).toBe(true);
      const over = schema.safeParse(build(cap + 1));
      expect(over.success).toBe(false);
      expect(over.error?.issues.map((issue) => issue.path)).toEqual([path]);
    },
  );

  it('is frozen and every cap is a positive safe integer', () => {
    expect(Object.isFrozen(L)).toBe(true);
    for (const [name, cap] of Object.entries(L))
      expect(Number.isSafeInteger(cap) && cap > 0, name).toBe(true);
  });

  it('Receipt.signals is bounded by its closed vocabulary (§8 v1.3), within L.REASONS', () => {
    const all = Object.fromEntries(ReceiptSignal.options.map((key) => [key, 1]));
    expect(ReceiptSignal.options.length).toBeLessThanOrEqual(L.REASONS);
    expect(Receipt.safeParse({ ...RECEIPT, signals: all }).success).toBe(true);
    const over = Receipt.safeParse({ ...RECEIPT, signals: { ...all, ...keyed(1, 1) } });
    expect(over.error?.issues.map((issue) => issue.path)).toEqual([['signals', 'k0']]);
  });

  it('caps amounts at 10^12 cents and timestamps at nanosecond precision', () => {
    expect(L.AMOUNT_CENTS).toBe(10 ** 12);
    expect(IsoTs.safeParse('2026-10-06T14:02:00.123456789+05:30').success).toBe(true);
    expect('2026-10-06T14:02:00.123456789+05:30').toHaveLength(L.ISO_TS);
  });
});
