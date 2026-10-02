/**
 * docs/grading.md v1.3 cross-field checks in src/core/schema.ts, plus ReceiptOverride. Same contract as
 * schema.spec.ts: at least five valid cases per table (each parses to exactly itself) and five invalid ones,
 * each rejected at one specific path.
 *  - Claim.claimedAtEnd (§4.1): `day` precision only, in `(claimedAt, start(day, t) + 25 h]`, where the day is
 *    the one containing `claimedAt` in `claimedAt`'s own written offset.
 *  - Observation (§10): `id === idFromHash(contentHash)`.
 *  - Receipt.signals (§8): keys are the §5.1 feature names plus `score`, nothing else.
 *  - ReceiptOverride and OverrideGrade (§8): an override is to VERIFIED or NOT_FOUND.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { features } from '../../../src/core/features';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY, FeatureName } from '../../../src/core/policy';
import {
  Claim,
  MatchFeature,
  Observation,
  OverrideGrade,
  Receipt,
  ReceiptOverride,
  ReceiptSignal,
} from '../../../src/core/schema';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../../../src/core/units';

type Path = readonly (string | number)[];
type Invalid = readonly [label: string, value: unknown, path: Path];
interface Table {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly Invalid[];
}

const ULID = '01JA0000000000000000000001';
const HASH = 'ab'.repeat(32);
const OTHER_HASH = 'cd'.repeat(32);
const T1 = '2026-10-06T15:00:00-04:00';

const CLAIM = {
  id: ULID,
  agent: 'muse',
  type: 'email.sent',
  claimedAt: '2026-10-06T00:00:00-04:00',
  claimedAtPrecision: 'day',
  observedAt: T1,
  sourceKind: 'activity_view',
  extractor: { id: 'muse.activity', version: '1.0.0', confidence: 1 },
  rawHash: HASH,
};

/** A day claim at `claimedAt` ending at `claimedAtEnd`. */
const day = (claimedAt: string, claimedAtEnd: string) => ({ ...CLAIM, claimedAt, claimedAtEnd });

/** A schema-valid observation whose contentHash covers its content and whose id derives from it (§10). */
function observation(content: Record<string, unknown>): Record<string, unknown> {
  const hashed = { source: 'gmail.sent', type: 'email.sent', occurredAt: T1, ...content };
  const contentHash = sha256Hex(canonicalJson(hashed));
  return { ...hashed, id: idFromHash(contentHash), observedAt: T1, contentHash };
}

const EMAIL = observation({ counterparty: 'priya@company.com', subjectHint: 'Q3 deck' });

const RECEIPT = {
  id: ULID,
  agent: 'muse',
  claimId: ULID,
  observationIds: [],
  grade: 'NOT_FOUND',
  confidence: 1,
  ruleId: 'not_found',
  reasons: [{ code: 'match.none', params: {} }],
  signals: { timeProximity: 1, score: 1 },
  state: 'PENDING',
  policyHash: HASH,
  inputsHash: HASH,
  computedAt: T1,
};
const signals = (value: Record<string, unknown>) => ({ ...RECEIPT, signals: value });

const OVERRIDE = { grade: 'NOT_FOUND', reason: 'I cancelled it myself', at: T1, previousState: 'PENDING' };

const TABLES: readonly Table[] = [
  {
    name: 'Claim.claimedAtEnd (day precision, at most start(day, t) + 25 h)',
    schema: Claim,
    valid: [
      day('2026-10-06T00:00:00-04:00', '2026-10-07T00:00:00-04:00'), // a 24-hour day
      day('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00'), // fall back: exactly 25 h, inclusive
      day('2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00'), // spring forward: 23 h
      day('2026-10-06T14:02:00-04:00', '2026-10-07T01:00:00-04:00'), // from the day start, not from 14:02
      // The day is claimedAt's own: 00:00+14:00 is 10:00Z the day before, so 11:00Z is start + 25 h.
      day('2026-10-06T00:00:00+14:00', '2026-10-06T11:00:00Z'),
      day('2026-10-06T00:00:00-12:00', '2026-10-07T13:00:00Z'), // 12:00Z start + 25 h
      { ...CLAIM, claimedAtPrecision: 'minute' }, // no claimedAtEnd: any precision
    ],
    invalid: [
      [
        'a claimedAtEnd on a minute claim',
        { ...day('2026-10-06T14:02:00-04:00', '2026-10-06T14:03:00-04:00'), claimedAtPrecision: 'minute' },
        ['claimedAtEnd'],
      ],
      [
        'a claimedAtEnd on an hour claim',
        { ...day('2026-10-06T14:00:00-04:00', '2026-10-06T15:00:00-04:00'), claimedAtPrecision: 'hour' },
        ['claimedAtEnd'],
      ],
      [
        'one ms past 25 h',
        day('2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00.001-05:00'),
        ['claimedAtEnd'],
      ],
      ['two days long', day('2026-10-06T23:30:00-04:00', '2026-10-08T00:00:00-04:00'), ['claimedAtEnd']],
      // Measured from 00:00+14:00 (10:00Z), not from the UTC day; 11:00:00.001Z is past 25 h.
      [
        'past 25 h from its own day',
        day('2026-10-06T00:00:00+14:00', '2026-10-06T11:00:00.001Z'),
        ['claimedAtEnd'],
      ],
      ['equal to claimedAt', day('2026-10-06T00:00:00-04:00', '2026-10-06T04:00:00Z'), ['claimedAtEnd']],
      ['before claimedAt', day('2026-10-06T00:00:00-04:00', '2026-10-05T23:59:59-04:00'), ['claimedAtEnd']],
    ],
  },
  {
    name: 'Observation (id = idFromHash(contentHash))',
    schema: Observation,
    valid: [
      EMAIL,
      observation({ counterparty: 'priya@company.com', rowKeyHash: HASH }),
      observation({ source: 'gmail.receipt', type: 'purchase.made', merchant: 'acme', amountCents: 4999 }),
      observation({ source: 'gcal.event', type: 'calendar.created', subjectHint: 'Standup' }),
      observation({}),
      // The schema checks the id against the stored hash; redact.ts is what makes the hash cover the content.
      { ...EMAIL, contentHash: HASH, id: idFromHash(HASH) },
    ],
    invalid: [
      ['an id from another hash', { ...EMAIL, id: idFromHash(OTHER_HASH) }, ['id']],
      ['a hand-picked valid ULID', { ...EMAIL, id: ULID }, ['id']],
      ['a new contentHash under the old id', { ...EMAIL, contentHash: OTHER_HASH }, ['id']],
      ['an id derived from the rowKeyHash', { ...EMAIL, rowKeyHash: HASH, id: idFromHash(HASH) }, ['id']],
      ['the right id in lowercase', { ...EMAIL, id: String(EMAIL.id).toLowerCase() }, ['id']],
      // A bad hash is reported once, at its own path: the cross-check has nothing to compare.
      ['an uppercase contentHash', { ...EMAIL, contentHash: OTHER_HASH.toUpperCase() }, ['contentHash']],
      ['a missing contentHash', { ...EMAIL, contentHash: undefined }, ['contentHash']],
    ],
  },
  {
    name: 'Receipt.signals (§5.1 feature names plus score)',
    schema: Receipt,
    valid: [
      RECEIPT,
      signals({}),
      signals({ score: 0.5 }),
      signals(Object.fromEntries(ReceiptSignal.options.map((key) => [key, 0]))),
      signals({ counterpartyName: 1, subjectOverlap: 0.3333, modelScore: 0, score: 0.6111 }),
    ],
    invalid: [
      ['an attribution signal', signals({ userIdle: 1 }), ['signals', 'userIdle']],
      ['a signal named like a feature in another case', signals({ Score: 1 }), ['signals', 'Score']],
      ['a made-up feature', signals({ score: 1, senderReputation: 1 }), ['signals', 'senderReputation']],
      ['an inherited key name', signals({ toString: 1 }), ['signals', 'toString']],
      ['a text value', signals({ timeProximity: '1' }), ['signals', 'timeProximity']],
      ['a key that is not an identifier', signals({ 'time proximity': 1 }), ['signals', 'time proximity']],
    ],
  },
  {
    name: 'ReceiptOverride',
    schema: ReceiptOverride,
    valid: [
      OVERRIDE,
      { ...OVERRIDE, grade: 'VERIFIED', previousState: 'FINAL' },
      { ...OVERRIDE, reason: 'x'.repeat(120) },
      { ...OVERRIDE, reason: 'x' },
      { ...OVERRIDE, at: '2026-10-06T19:00:00Z' },
      { ...OVERRIDE, reason: '​Já cancelei' },
    ],
    invalid: [
      ['an override to PARTIAL', { ...OVERRIDE, grade: 'PARTIAL' }, ['grade']],
      ['an empty reason', { ...OVERRIDE, reason: '' }, ['reason']],
      ['a blank reason', { ...OVERRIDE, reason: ' \t ' }, ['reason']],
      ['an invisible-only reason', { ...OVERRIDE, reason: '​‎﻿' }, ['reason']],
      ['a smuggled note', { ...OVERRIDE, note: 'called Priya' }, []],
      ['a reason over 120', { ...OVERRIDE, reason: 'x'.repeat(121) }, ['reason']],
      ['a previous USER_OVERRIDDEN', { ...OVERRIDE, previousState: 'USER_OVERRIDDEN' }, ['previousState']],
      ['a missing at', { ...OVERRIDE, at: undefined }, ['at']],
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

/** The messages of every issue a parse raised. */
function messages(schema: z.ZodType, value: unknown): string[] {
  return schema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
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

describe('Claim.claimedAtEnd: the messages say which rule failed', () => {
  it('names the precision rule, the order rule and the 25-hour rule', () => {
    const minute = { ...day(CLAIM.claimedAt, '2026-10-06T00:01:00-04:00'), claimedAtPrecision: 'minute' };
    expect(messages(Claim, minute)).toEqual(['allowed only with day precision']);
    expect(messages(Claim, day(CLAIM.claimedAt, CLAIM.claimedAt))).toEqual(['must be after claimedAt']);
    expect(messages(Claim, day(CLAIM.claimedAt, '2026-10-07T01:00:00.001-04:00'))).toEqual([
      'must be at most 25 h after the start of the claimedAt day',
    ]);
  });

  /** The written ±hh:mm of an offset in minutes. */
  const written = (minutes: number): string => {
    const sign = minutes < 0 ? '-' : '+';
    const magnitude = Math.abs(minutes);
    const hh = String(Math.floor(magnitude / 60)).padStart(2, '0');
    return `${sign}${hh}:${String(magnitude % 60).padStart(2, '0')}`;
  };
  const isoAt = (epochMs: number, offset: number): string =>
    `${new Date(epochMs + offset * MS_PER_MINUTE).toISOString().slice(0, -1)}${written(offset)}`;

  it('accepts start + 25 h and rejects 1 ms more, for any day, offset and time of day (property)', () => {
    const arbitrary = fc.record({
      dayIndex: fc.integer({ min: 0, max: 20_000 }),
      offset: fc.integer({ min: -(14 * 60), max: 14 * 60 }).map((m) => m - (m % 15)),
      minuteOfDay: fc.integer({ min: 0, max: 24 * 60 - 1 }),
    });
    fc.assert(
      fc.property(arbitrary, ({ dayIndex, offset, minuteOfDay }) => {
        // Local midnight of day `dayIndex` at `offset`, as an instant; claimedAt is written in that offset.
        const startMs = dayIndex * MS_PER_DAY - offset * MS_PER_MINUTE;
        const claimedAt = isoAt(startMs + minuteOfDay * MS_PER_MINUTE, offset);
        const lastMs = startMs + MS_PER_DAY + MS_PER_HOUR;
        expect(Claim.safeParse(day(claimedAt, new Date(lastMs).toISOString())).success).toBe(true);
        expect(Claim.safeParse(day(claimedAt, new Date(lastMs + 1).toISOString())).success).toBe(false);
      }),
      { numRuns: 1_000 },
    );
  }, 30_000);
});

describe('Receipt signals and the policy share one feature vocabulary', () => {
  it('MatchFeature is the policy FeatureName enum, and ReceiptSignal adds only score', () => {
    expect(MatchFeature.options).toEqual(FeatureName.options);
    expect(ReceiptSignal.options).toEqual([...MatchFeature.options, 'score']);
  });

  it('every signals record features() produces is a valid receipt signals record', () => {
    const claim = {
      type: 'email.sent' as const,
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
      claimedAt: '2026-10-06T14:02:00-04:00',
      claimedAtPrecision: 'minute' as const,
    };
    const result = features(claim, { occurredAt: '2026-10-06T14:05:00-04:00' }, DEFAULT_POLICY);
    expect(Object.keys(result.signals).length).toBeGreaterThan(1);
    expect(Receipt.safeParse(signals(result.signals)).success).toBe(true);
  });

  it('OverrideGrade is exactly VERIFIED and NOT_FOUND', () => {
    expect(OverrideGrade.options).toEqual(['VERIFIED', 'NOT_FOUND']);
  });
});
