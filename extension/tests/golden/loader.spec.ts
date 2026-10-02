/**
 * The golden loader applies exactly the defaults docs/grading.md §15 documents, hashes every label, and does
 * its time arithmetic in the timestamp's own offset (never the host time zone: `pnpm test:tz` reruns this).
 */
import { describe, expect, it } from 'vitest';

import { hashCanonical, idFromHash, sha256Hex } from '../../src/core/hash';
import { buildScenario, contentHashOf, defaultObservedAt, mergePatch } from './load';
import {
  ExpectedReceipt,
  parseFraction,
  Scenario,
  type ScenarioCoverage,
  type ScenarioObservation,
} from './scenario-schema';
import { formatInOffset, shiftIso, truncateIso } from './time';

const SENT: ScenarioObservation = {
  ref: 'o1',
  source: 'gmail.sent',
  type: 'email.sent',
  counterparty: 'priya@company.com',
  subjectHint: 'Q3 deck',
  occurredAt: '2026-10-06T14:02:00-04:00',
};

const entry = (lastSyncAt: string, windowStart: string, windowEnd: string): ScenarioCoverage => ({
  source: 'gmail.sent',
  lastSyncAt,
  windowStart,
  windowEnd,
});

const MINIMAL = Scenario.parse({
  name: 'defaults',
  covers: ['test:defaults'],
  mode: 'batch',
  input: {
    evaluatedAt: '2026-10-06T15:00:00-04:00',
    claims: [{ ref: 'c1', agent: 'muse', type: 'email.sent', claimedAt: '2026-10-06T14:02:30-04:00' }],
    observations: [SENT],
    grants: [{ agent: 'muse', accounts: { 'gmail.sent': ['acct-a'] } }],
    coverage: [
      {
        ...entry('2026-10-06T15:00:00-04:00', '2026-10-06T12:00:00-04:00', '2026-10-06T15:00:00-04:00'),
        accountHash: 'acct-a',
      },
    ],
  },
  expect: [],
});

describe('golden loader defaults (§15): claims and observations', () => {
  const loaded = buildScenario('defaults.json', MINIMAL);
  const claim = loaded.claims.get('c1');

  it('fills the claim defaults and derives rawHash and id per §10', () => {
    expect(claim).toMatchObject({
      claimedAtPrecision: 'minute',
      sourceKind: 'activity_view',
      observedAt: '2026-10-06T14:02:30-04:00',
      extractor: { id: 'golden', version: '1', confidence: 1 },
    });
    const rawHash = hashCanonical({
      agent: 'muse',
      sourceKind: 'activity_view',
      rowKeyHash: null,
      text: 'c1',
      claimedAt: '2026-10-06T14:02:00-04:00',
    });
    expect(claim?.rawHash).toBe(rawHash);
    expect(claim?.id).toBe(idFromHash(rawHash));
  });

  it('hashes the allowlisted observation content into contentHash and the id', () => {
    const obs = loaded.observations.get('o1');
    const contentHash = hashCanonical({
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: 'priya@company.com',
      subjectHint: 'Q3 deck',
      occurredAt: '2026-10-06T14:02:00-04:00',
    });
    expect(obs?.contentHash).toBe(contentHash);
    expect(obs?.id).toBe(idFromHash(contentHash));
    const keyed = contentHashOf({ ...SENT, rowKey: 'send-1' }, sha256Hex('send-1'), ['counterparty']);
    expect(keyed).not.toBe(contentHashOf(SENT, undefined, ['counterparty']));
  });
});

describe('golden loader defaults (§15): grants, coverage, activity, observedAt', () => {
  const loaded = buildScenario('defaults.json', MINIMAL);
  const claim = loaded.claims.get('c1');

  it('fills the grant defaults, updatedAt one day before evaluatedAt, and hashes account labels', () => {
    expect(loaded.grants[0]).toMatchObject({
      counterpartyAllowlist: [],
      spendCeilingCents: null,
      declaredScopes: [],
      updatedAt: '2026-10-05T15:00:00-04:00',
      accounts: { 'gmail.sent': [sha256Hex('acct-a')] },
    });
    expect(loaded.grants[0]?.allowedTypes).toHaveLength(9);
    expect(loaded.coverage.observers[0]).toMatchObject({
      observerId: 'gmail.sent',
      accountHash: sha256Hex('acct-a'),
    });
  });

  it('defaults activity to empty lists and every claim', () => {
    expect(loaded.activity).toMatchObject({ sessions: [], idle: [], entries: [], adapterSyncs: [] });
    expect(loaded.activity.claims.map((c) => c.id)).toEqual([claim?.id]);
  });

  it('observation observedAt = the earliest covering sync ≤ evaluatedAt, else evaluatedAt', () => {
    const coverage = [
      entry('2026-10-06T14:40:00-04:00', '2026-10-06T12:00:00-04:00', '2026-10-06T14:40:00-04:00'),
      entry('2026-10-06T14:10:00-04:00', '2026-10-06T12:00:00-04:00', '2026-10-06T14:10:00-04:00'),
      entry('2026-10-06T14:05:00-04:00', '2026-10-06T14:03:00-04:00', '2026-10-06T14:05:00-04:00'),
      entry('2026-10-06T13:00:00-04:00', '2026-10-06T14:00:00-04:00', '2026-10-06T16:00:00-04:00'),
    ];
    expect(defaultObservedAt(SENT, coverage, '2026-10-06T15:00:00-04:00')).toBe('2026-10-06T13:00:00-04:00');
    expect(defaultObservedAt(SENT, coverage.slice(0, 3), '2026-10-06T15:00:00-04:00')).toBe(
      '2026-10-06T14:10:00-04:00',
    );
    expect(defaultObservedAt(SENT, coverage.slice(0, 1), '2026-10-06T14:30:00-04:00')).toBe(
      '2026-10-06T14:30:00-04:00',
    );
    expect(defaultObservedAt({ ...SENT, source: 'gcal.event' }, coverage, '2026-10-06T15:00:00-04:00')).toBe(
      '2026-10-06T15:00:00-04:00',
    );
  });
});

describe('golden time helpers', () => {
  it.each([
    ['2026-10-06T14:02:59.999-04:00', 'minute', '2026-10-06T14:02:00-04:00'],
    ['2026-10-06T14:02:00-04:00', 'hour', '2026-10-06T14:00:00-04:00'],
    ['2026-10-06T00:30:00-04:00', 'day', '2026-10-06T00:00:00-04:00'],
    ['2026-10-06T23:58:00-07:00', 'day', '2026-10-06T00:00:00-07:00'],
    ['2026-10-06T01:15:00+05:45', 'hour', '2026-10-06T01:00:00+05:45'],
    ['2026-10-06T18:02:00Z', 'day', '2026-10-06T00:00:00Z'],
  ] as const)('truncateIso(%s, %s) stays in the claim offset', (iso, precision, want) => {
    expect(truncateIso(iso, precision)).toBe(want);
  });

  it('shifts and formats in the given offset, with milliseconds only when present', () => {
    expect(shiftIso('2026-11-01T02:00:00-08:00', -86_400_000)).toBe('2026-10-31T02:00:00-08:00');
    expect(formatInOffset(Date.UTC(2026, 9, 6, 18, 4, 0, 1), '-04:00')).toBe('2026-10-06T14:04:00.001-04:00');
  });
});

describe('policy merge patch (RFC 7386) and fractions', () => {
  it('merges objects, replaces arrays and scalars, deletes on null', () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 'x', e: true };
    expect(mergePatch(base, { a: { c: [3] }, d: null, f: 2 })).toEqual({
      a: { b: 1, c: [3] },
      e: true,
      f: 2,
    });
    expect(mergePatch(base, {})).toEqual(base);
    expect(base).toEqual({ a: { b: 1, c: [1, 2] }, d: 'x', e: true });
  });

  it('parses and rejects score fractions', () => {
    expect(parseFraction('9503999/9504000')).toEqual({ num: 9503999n, den: 9504000n });
    const base = { ref: 'c1', grade: 'VERIFIED', ruleId: 'verified', state: 'FINAL', observationRefs: [] };
    for (const score of ['2/4', '3/2', '1/0', '0.85', '-1/2']) {
      expect(ExpectedReceipt.safeParse({ ...base, score, reasonCodes: [] }).success, score).toBe(false);
    }
    expect(ExpectedReceipt.safeParse({ ...base, score: '17/20', reasonCodes: [] }).success).toBe(true);
  });
});

const DAY_CLAIM = Scenario.parse({
  ...MINIMAL,
  input: {
    ...MINIMAL.input,
    claims: [
      {
        ref: 'c1',
        agent: 'muse',
        type: 'email.sent',
        counterparty: 'priya@company.com',
        claimedAt: '2026-11-01T00:00:00-07:00',
        claimedAtPrecision: 'day',
        claimedAtEnd: '2026-11-02T00:00:00-08:00',
      },
    ],
  },
  expect: [
    {
      ref: 'c1',
      grade: 'VERIFIED',
      ruleId: 'verified',
      state: 'USER_OVERRIDDEN',
      observationRefs: ['o1'],
      score: '1/1',
      reasonCodes: ['match.best', 'override.user'],
      reasonParams: { 'match.best': { observationId: 'o1' }, 'override.user': { grade: 'NOT_FOUND' } },
      override: 'NOT_FOUND',
      previousState: 'FINAL',
    },
  ],
});

describe('golden loader (v1.2): claimedAtEnd and reason params', () => {
  const loaded = buildScenario('day.json', DAY_CLAIM);
  const claim = loaded.claims.get('c1');

  it('passes claimedAtEnd through as written and keeps it out of rawHash (§4.1, §10)', () => {
    expect(claim?.claimedAtEnd).toBe('2026-11-02T00:00:00-08:00');
    const rawHash = hashCanonical({
      agent: 'muse',
      sourceKind: 'activity_view',
      rowKeyHash: null,
      text: 'c1',
      claimedAt: '2026-11-01T00:00:00-07:00',
    });
    expect(claim?.rawHash).toBe(rawHash);
  });

  it('resolves param refs to ids and keeps the reason order of reasonCodes (§15)', () => {
    const [resolved] = loaded.expected;
    expect(resolved?.reasons).toEqual([
      { code: 'match.best', params: { observationId: loaded.observations.get('o1')?.id } },
      { code: 'override.user', params: { grade: 'NOT_FOUND' } },
    ]);
    const [first] = DAY_CLAIM.expect;
    expect(first).toBeDefined();
    if (first === undefined) return;
    const codesOnly = { ...first };
    delete codesOnly.reasonParams;
    const without = buildScenario('codes.json', { ...DAY_CLAIM, expect: [codesOnly] });
    expect(without.expected[0]?.reasons).toBeUndefined();
  });
});
