/**
 * Task 1.0: the canonical object schemas (src/core/schema.ts, docs/grading.md §3, §7, §13, §15). For every
 * schema, at least five valid cases (each parses to exactly itself) and five invalid ones, each rejected at
 * one specific path. Grading-input schemas are in schema-grading.spec.ts, primitives and enums in
 * schema-primitives.spec.ts, caps in schema-limits.spec.ts, Reason and its closed params in
 * schema-reasons.spec.ts, ReceiptOverride and the v1.3 cross-field checks in schema-cross-checks.spec.ts,
 * Receipt and its invariants in schema-receipt.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { idFromHash } from '../../../src/core/hash';
import { Claim, Grant, HealthReport, Observation, Request } from '../../../src/core/schema';

type Path = readonly (string | number)[];
type Invalid = readonly [label: string, value: unknown, path: Path];
interface Table {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly Invalid[];
}

const ULID = '01JA0000000000000000000001';
const ULID_B = '01JA0000000000000000000002';
const HASH = 'ab'.repeat(32);
const T0 = '2026-10-06T14:02:00-04:00';
const T1 = '2026-10-06T15:00:00-04:00';
const x = (length: number): string => 'x'.repeat(length);

/** A copy of `value` without `key`. */
function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

const REQUEST = {
  id: ULID,
  agent: 'muse',
  conversationId: 'conv-1',
  textHint: 'Email Priya',
  textHash: HASH,
  ts: T0,
};

/** §10 (v1.4): a claim's id is idFromHash(rawHash), checked by the schema. */
const CLAIM = {
  id: idFromHash(HASH),
  agent: 'muse',
  type: 'email.sent',
  claimedAt: T0,
  claimedAtPrecision: 'minute',
  observedAt: T1,
  sourceKind: 'activity_view',
  extractor: { id: 'muse.activity', version: '1.0.0', confidence: 1 },
  rawHash: HASH,
};

/** §10 (v1.3): an observation's id is idFromHash(contentHash), checked by the schema. */
const DAY = { ...CLAIM, claimedAtPrecision: 'day' };

const OBSERVATION = {
  id: idFromHash(HASH),
  source: 'gmail.sent',
  type: 'email.sent',
  counterparty: 'priya@company.com',
  subjectHint: 'Q3 deck',
  occurredAt: T0,
  observedAt: T1,
  contentHash: HASH,
};

const GRANT = {
  agent: 'muse',
  allowedTypes: ['email.sent'],
  counterpartyAllowlist: [],
  spendCeilingCents: null,
  declaredScopes: [],
  updatedAt: T0,
};

const HEALTH = { adapterId: 'gmail.sent', version: '1.0.0', status: 'OK', reasons: [], checkedAt: T0 };

const TABLES: readonly Table[] = [
  {
    name: 'Request',
    schema: Request,
    valid: [
      REQUEST,
      { ...REQUEST, agent: 'chatgpt', ts: '2026-10-06T18:02:00Z' },
      { ...REQUEST, conversationId: '', textHint: '' },
      { ...REQUEST, textHint: x(200), ts: '2026-10-06T23:32:00.123+05:30' },
      { ...REQUEST, agent: 'claude', conversationId: x(128) },
    ],
    invalid: [
      ['an unknown key', { ...REQUEST, transcript: 'full chat' }, []],
      ['a lowercase id', { ...REQUEST, id: ULID.toLowerCase() }, ['id']],
      ['an unknown agent', { ...REQUEST, agent: 'gemini' }, ['agent']],
      ['an uppercase textHash', { ...REQUEST, textHash: HASH.toUpperCase() }, ['textHash']],
      ['a ts without offset', { ...REQUEST, ts: '2026-10-06T14:02:00' }, ['ts']],
      ['a missing ts', without(REQUEST, 'ts'), ['ts']],
      ['a textHint over 200', { ...REQUEST, textHint: x(201) }, ['textHint']],
    ],
  },
  {
    name: 'Claim',
    schema: Claim,
    valid: [
      CLAIM,
      { ...CLAIM, requestId: ULID_B, counterparty: 'Priya', subjectHint: 'Q3 deck' },
      {
        ...CLAIM,
        type: 'calendar.created',
        claimedAtPrecision: 'day',
        targetAt: '2026-10-09T10:00:00-04:00',
      },
      { ...CLAIM, type: 'purchase.made', amountCents: 0, currency: 'JPY', claimedAtPrecision: 'hour' },
      { ...CLAIM, type: 'purchase.made', amountCents: 1e12, currency: 'USD', sourceKind: 'chat' },
      // v1.2 §4.1: the local day of the US fall-back is 25 hours, so its end is the next local midnight.
      {
        ...CLAIM,
        claimedAt: '2026-11-01T00:00:00-04:00',
        claimedAtPrecision: 'day',
        claimedAtEnd: '2026-11-02T00:00:00-05:00',
      },
      // 09:02Z then 10:00Z: after as instants although the strings sort the other way.
      { ...DAY, claimedAt: '2026-10-06T14:02:00+05:00', claimedAtEnd: '2026-10-06T10:00:00Z' },
      // The US spring-forward day is 23 hours: it ends at the next local midnight, in the summer offset.
      {
        ...CLAIM,
        claimedAt: '2026-03-08T00:00:00-05:00',
        claimedAtPrecision: 'day',
        claimedAtEnd: '2026-03-09T00:00:00-04:00',
      },
      { ...DAY, claimedAtEnd: '2026-10-07T04:00:00Z' }, // the next local midnight, written in UTC
      { ...DAY, claimedAtEnd: '2026-10-06T14:02:00.001-04:00' }, // one millisecond is strictly after
    ],
    invalid: [
      ['a claimedAtEnd equal to claimedAt', { ...DAY, claimedAtEnd: T0 }, ['claimedAtEnd']],
      [
        'a claimedAtEnd at the same instant in another offset',
        { ...DAY, claimedAtEnd: '2026-10-06T18:02:00Z' },
        ['claimedAtEnd'],
      ],
      [
        'a claimedAtEnd before claimedAt',
        { ...DAY, claimedAtEnd: '2026-10-06T14:01:59-04:00' },
        ['claimedAtEnd'],
      ],
      // 18:02Z then 10:00Z: before as instants although the string sorts after.
      [
        'a claimedAtEnd that only sorts after',
        { ...DAY, claimedAtEnd: '2026-10-06T15:00:00+05:00' },
        ['claimedAtEnd'],
      ],
      ['a claimedAtEnd without offset', { ...DAY, claimedAtEnd: '2026-10-07T00:00:00' }, ['claimedAtEnd']],
      ['a missing claimedAtPrecision', without(CLAIM, 'claimedAtPrecision'), ['claimedAtPrecision']],
      ['a precision of second', { ...CLAIM, claimedAtPrecision: 'second' }, ['claimedAtPrecision']],
      ['a date-only targetAt', { ...CLAIM, targetAt: '2026-10-09' }, ['targetAt']],
      ['a negative amount', { ...CLAIM, amountCents: -1 }, ['amountCents']],
      ['a fractional amount', { ...CLAIM, amountCents: 1.5 }, ['amountCents']],
      ['a lowercase currency', { ...CLAIM, currency: 'usd' }, ['currency']],
      [
        'a confidence above 1',
        { ...CLAIM, extractor: { ...CLAIM.extractor, confidence: 1.5 } },
        ['extractor', 'confidence'],
      ],
      [
        'an extractor smuggling html',
        { ...CLAIM, extractor: { ...CLAIM.extractor, html: '<p>' } },
        ['extractor'],
      ],
      ['an unknown sourceKind', { ...CLAIM, sourceKind: 'email' }, ['sourceKind']],
      ['a malformed requestId', { ...CLAIM, requestId: 'req-1' }, ['requestId']],
      ['a smuggled transcript', { ...CLAIM, transcript: 'Sure, emailing Priya now' }, []],
      ['an id not derived from rawHash (v1.4)', { ...CLAIM, id: ULID }, ['id']],
    ],
  },
  {
    name: 'Observation',
    schema: Observation,
    valid: [
      OBSERVATION,
      { ...OBSERVATION, rowKeyHash: HASH },
      {
        ...without(OBSERVATION, 'counterparty'),
        source: 'gmail.receipt',
        type: 'purchase.made',
        merchant: 'Blue Bottle',
        amountCents: 1250,
        currency: 'USD',
      },
      { ...OBSERVATION, source: 'gcal.event', type: 'calendar.deleted', subjectHint: x(80) },
      without(without(OBSERVATION, 'counterparty'), 'subjectHint'),
    ],
    invalid: [
      ['a rowKeyHash that is a raw row id', { ...OBSERVATION, rowKeyHash: 'row-17' }, ['rowKeyHash']],
      ['an unknown source', { ...OBSERVATION, source: 'outlook' }, ['source']],
      ['an unknown type', { ...OBSERVATION, type: 'email.received' }, ['type']],
      ['a missing contentHash', without(OBSERVATION, 'contentHash'), ['contentHash']],
      ['an id not derived from contentHash', { ...OBSERVATION, id: ULID }, ['id']],
      ['a smuggled body', { ...OBSERVATION, body: 'Hi Priya, the code is 7731' }, []],
      ['an occurredAt without offset', { ...OBSERVATION, occurredAt: '2026-10-06T14:02' }, ['occurredAt']],
      ['a subjectHint over 80', { ...OBSERVATION, subjectHint: x(81) }, ['subjectHint']],
      // v1.2 §10: every currency is a 3-letter uppercase ISO 4217 code, so equal currencies compare equal.
      ['a lowercase currency', { ...OBSERVATION, amountCents: 1250, currency: 'usd' }, ['currency']],
      ['a currency symbol', { ...OBSERVATION, amountCents: 1250, currency: 'US$' }, ['currency']],
    ],
  },
  {
    name: 'Grant',
    schema: Grant,
    valid: [
      GRANT,
      { ...GRANT, spendCeilingCents: 5000, spendCurrency: 'USD' },
      { ...GRANT, spendCeilingCents: 0, spendCurrency: 'EUR', observedScopes: ['gmail.send'] },
      { ...GRANT, accounts: { 'gmail.sent': [HASH], 'gcal.event': [] } },
      {
        ...GRANT,
        allowedTypes: ['email.sent', 'calendar.created'],
        counterpartyAllowlist: ['company.com'],
        spendCurrency: 'USD',
      },
    ],
    invalid: [
      ['a ceiling without its currency', { ...GRANT, spendCeilingCents: 5000 }, ['spendCurrency']],
      [
        'a negative ceiling',
        { ...GRANT, spendCeilingCents: -1, spendCurrency: 'USD' },
        ['spendCeilingCents'],
      ],
      ['a missing ceiling', without(GRANT, 'spendCeilingCents'), ['spendCeilingCents']],
      ['a currency name', { ...GRANT, spendCurrency: 'dollars' }, ['spendCurrency']],
      [
        'a lowercase spendCurrency',
        { ...GRANT, spendCeilingCents: 5000, spendCurrency: 'usd' },
        ['spendCurrency'],
      ],
      ['accounts for an unknown source', { ...GRANT, accounts: { outlook: [HASH] } }, ['accounts']],
      [
        'an account that is not a hash',
        { ...GRANT, accounts: { 'gmail.sent': ['me@gmail.com'] } },
        ['accounts', 'gmail.sent', 0],
      ],
      ['an unknown allowed type', { ...GRANT, allowedTypes: ['email.read'] }, ['allowedTypes', 0]],
      ['ten allowed types', { ...GRANT, allowedTypes: Array(10).fill('other') }, ['allowedTypes']],
      ['a smuggled account address', { ...GRANT, account: 'me@gmail.com' }, []],
    ],
  },
  {
    name: 'HealthReport',
    schema: HealthReport,
    valid: [
      HEALTH,
      { ...HEALTH, status: 'DEGRADED', reasons: ['selector.missing', 'not_sent_folder'] },
      { ...HEALTH, adapterId: 'muse', version: '2.3.1-beta' },
      { ...HEALTH, checkedAt: '2026-10-06T18:02:00.5Z' },
      { ...HEALTH, status: 'DEGRADED', reasons: Array(32).fill('r') },
    ],
    invalid: [
      ['an unknown status', { ...HEALTH, status: 'BROKEN' }, ['status']],
      ['an empty adapterId', { ...HEALTH, adapterId: '' }, ['adapterId']],
      ['a reason over 120', { ...HEALTH, reasons: [x(121)] }, ['reasons', 0]],
      ['a checkedAt of now', { ...HEALTH, checkedAt: 'now' }, ['checkedAt']],
      ['a smuggled dom', { ...HEALTH, dom: '<div>' }, []],
    ],
  },
];

/** The distinct paths of every issue a parse raised; empty when it parsed. */
function issuePaths(schema: z.ZodType, value: unknown): Path[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  const paths = result.error.issues.map((issue) =>
    issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key)),
  );
  return [...new Map(paths.map((path) => [JSON.stringify(path), path])).values()];
}

describe.each(TABLES)('$name', ({ schema, valid, invalid }) => {
  it('has at least five valid and five invalid cases', () => {
    expect(valid.length).toBeGreaterThanOrEqual(5);
    expect(invalid.length).toBeGreaterThanOrEqual(5);
  });

  it.each(valid.map((value, index) => ({ index, value })))(
    'parses valid case $index to exactly itself',
    ({ value }) => {
      expect(schema.parse(value)).toEqual(value);
    },
  );

  it.each(invalid.map(([label, value, path]) => ({ label, value, path })))(
    'rejects $label at $path',
    ({ value, path }) => {
      expect(issuePaths(schema, value)).toEqual([path]);
    },
  );
});
