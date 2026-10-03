/**
 * What replay compares (src/core/replay-compare.ts; docs/grading.md §8, §9, §10): the recomputed content hash
 * agrees with redact.ts `project` (so replay's evidence check is the §10 definition, not a copy of it that could
 * drift), and `compareReceipts` sees every computed field while setting the lifecycle part (override, reverted
 * overrides, supersession, their reasons) aside.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { canonicalJson, sha256Hex } from '../../../src/core/hash';
import { loadPolicy } from '../../../src/core/policy';
import { project } from '../../../src/core/redact';
import { COMPARED_FIELDS, compareReceipts, contentHashOf } from '../../../src/core/replay-compare';
import { IsoTs, Receipt } from '../../../src/core/schema';
import { transition } from '../../../src/core/state';

const policy = loadPolicy(defaultPolicyJson);
const OBSERVED_AT = '2026-09-02T10:05:00+00:00';
const TYPE_OF = {
  'gmail.sent': 'email.sent',
  'gmail.receipt': 'purchase.made',
  'gcal.event': 'calendar.created',
} as const;

describe('contentHashOf is the §10 content hash project() computes', () => {
  const rows = [
    [
      'gmail.sent',
      { counterparty: 'priya@acme.io', subjectHint: 'Q3 deck', occurredAt: '2026-09-02T10:00:00+02:00' },
    ],
    ['gmail.sent', { counterparty: 'bob@acme.io', occurredAt: '2026-09-02T10:00:00Z', secret: 'dropped' }],
    [
      'gmail.receipt',
      { merchant: 'Acme', amountCents: 1234, currency: 'USD', occurredAt: '2026-09-02T10:00:00Z' },
    ],
    ['gcal.event', { subjectHint: 'x'.repeat(200), occurredAt: '2026-09-03T09:00:00-07:00' }],
  ] as const;

  it.each(rows)('%s', (source, raw) => {
    for (const rowKey of [undefined, 'row-17']) {
      const observation = project(
        source,
        raw,
        { type: TYPE_OF[source], observedAt: OBSERVED_AT, rowKey },
        policy,
      );
      expect(contentHashOf(observation)).toBe(observation.contentHash);
      // observedAt is not content: the same row seen later is the same observation (§10).
      expect(contentHashOf({ ...observation, observedAt: IsoTs.parse('2026-09-05T00:00:00Z') })).toBe(
        observation.contentHash,
      );
      // Every content field is: changing one changes the hash.
      expect(contentHashOf({ ...observation, occurredAt: IsoTs.parse('2026-09-04T00:00:00Z') })).not.toBe(
        observation.contentHash,
      );
      expect(contentHashOf({ ...observation, subjectHint: 'other' })).not.toBe(observation.contentHash);
    }
  });
});

const BASE = Receipt.parse({
  id: '0000000000000000000000000A',
  agent: 'muse',
  claimId: '0000000000000000000000000B',
  observationIds: ['0000000000000000000000000C'],
  grade: 'VERIFIED',
  confidence: 0.9,
  ruleId: 'verified',
  reasons: [{ code: 'match.best', params: { observationId: '0000000000000000000000000C' } }],
  signals: { score: 0.9 },
  state: 'FINAL',
  policyHash: 'a'.repeat(64),
  inputsHash: 'b'.repeat(64),
  computedAt: '2026-09-02T10:00:00+00:00',
  finalAt: '2026-09-02T10:00:00+00:00',
});

describe('compareReceipts', () => {
  it('finds nothing between a receipt and itself, or a copy with its keys in another order', () => {
    const reordered = Object.fromEntries(Object.entries(BASE).reverse());
    expect(compareReceipts(BASE, BASE)).toEqual([]);
    expect(compareReceipts(Receipt.parse(reordered), BASE)).toEqual([]);
  });

  it('compares the subject, the four fields of §9, then every other field grading computed', () => {
    expect(COMPARED_FIELDS.slice(0, 5)).toEqual(['id', 'inputsHash', 'grade', 'ruleId', 'state']);
    const lifecycle = new Set(['override', 'reverted', 'supersededBy']);
    const computed = Receipt.keyof().options.filter((key) => !lifecycle.has(key));
    expect([...COMPARED_FIELDS].sort()).toEqual([...computed].sort());
  });

  it('sets the lifecycle part aside: overridden on its previousState, override and supersession reasons ignored', () => {
    const overridden = transition(BASE, {
      event: 'override',
      grade: 'NOT_FOUND',
      reason: 'it did not happen',
      at: '2026-09-02T11:00:00+00:00',
    });
    expect(overridden.reasons.map((r) => r.code)).toContain('override.user');
    expect(compareReceipts(overridden, BASE)).toEqual([]);
    expect(compareReceipts(overridden, { ...BASE, state: 'PENDING' })).toEqual([
      { field: 'state', stored: 'FINAL', replayed: 'PENDING' },
    ]);
    // A reverted override is lifecycle too: the receipt that keeps it compares as the receipt grading wrote.
    const reverted = transition(overridden, { event: 'revert', at: '2026-09-02T12:00:00+00:00' });
    expect(reverted.reverted).toHaveLength(1);
    expect(compareReceipts(reverted, BASE)).toEqual([]);
    expect(compareReceipts(reverted, { ...BASE, state: 'PENDING' })).toEqual([
      { field: 'state', stored: 'FINAL', replayed: 'PENDING' },
    ]);
  });

  it('writes values as ids, numbers and timestamps, and signals and reasons by hash', () => {
    const replayed = { ...BASE, confidence: 0.5, signals: { score: 0.5 }, reasons: [], finalAt: undefined };
    expect(compareReceipts(BASE, replayed)).toEqual([
      { field: 'confidence', stored: '0.9', replayed: '0.5' },
      { field: 'reasons', stored: sha256Hex(canonicalJson(BASE.reasons)), replayed: sha256Hex('[]') },
      {
        field: 'signals',
        stored: sha256Hex(canonicalJson(BASE.signals)),
        replayed: sha256Hex('{"score":0.5}'),
      },
      { field: 'finalAt', stored: BASE.finalAt, replayed: null },
    ]);
  });
});
