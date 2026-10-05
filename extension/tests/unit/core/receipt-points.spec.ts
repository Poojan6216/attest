/**
 * `gmail.receipt` point intervals (docs/grading.md v1.9 §3, §6.1, §7; Sprint 2 wave C interface 3): a pass that
 * parsed an opened receipt covers only that message's instant (`windowStart = windowEnd`).
 *
 *  - Inside a purchase claim's window a point makes coverage partial, never full, so a purchase is never NOT_FOUND
 *    on receipts (Hard Rule 5); outside it, none.
 *  - An exact receipt still verifies (`verified` comes before `partial_coverage`), and is FINAL once some receipt
 *    pass synced at `end(p,t) + graceMin`.
 *  - A receipt whose own instant is a point is an orphan candidate, so an unclaimed purchase can be UNASKED.
 *  - Points merge as closed intervals: the same message read twice is one window, two messages two.
 *
 * The purchase claim is at 14:02 (minute precision), Stripe $49.99: window [14:00, 14:48]; grace sync 14:48.
 */
import { describe, expect, it } from 'vitest';

import { gradeBatch } from '../../../src/core/batch';
import { isOrphanCandidate, seenWindows } from '../../../src/core/batch-orphans';
import { createMemoryIndex } from '../../../src/core/candidates';
import { coverageLevel } from '../../../src/core/conditions';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { coverageHash } from '../../../src/core/receipt-hash';
import type { Receipt } from '../../../src/core/schema';
import { buildCoverage } from '../../golden/build';
import { buildScenario, type LoadedScenario } from '../../golden/load';
import { Scenario, type ScenarioCoverage } from '../../golden/scenario-schema';

const at = (hhmm: string): string => `2026-10-06T${hhmm}:00-04:00`;
const EVAL = at('15:00');

/** The pass that parsed one opened receipt: its message's instant, read at `read`. */
const point = (instant: string, read: string): ScenarioCoverage => ({
  source: 'gmail.receipt',
  lastSyncAt: read,
  windowStart: instant,
  windowEnd: instant,
  accountHash: 'acct-a',
});
const CLAIM = {
  ref: 'c1',
  agent: 'muse',
  type: 'purchase.made',
  counterparty: 'Stripe',
  amountCents: 4999,
  currency: 'USD',
  claimedAt: at('14:02'),
} as const;
const RECEIPT = {
  ref: 'o1',
  source: 'gmail.receipt',
  type: 'purchase.made',
  merchant: 'Stripe',
  amountCents: 4999,
  currency: 'USD',
  occurredAt: at('14:03'),
  observedAt: at('14:10'),
} as const;

function load(input: Record<string, unknown>): LoadedScenario {
  const scenario = Scenario.parse({
    name: 'receipt points unit',
    covers: ['test:receipt_points'],
    mode: 'batch',
    input: {
      evaluatedAt: EVAL,
      claims: [],
      observations: [],
      grants: [{ agent: 'muse' }],
      coverage: [],
      ...input,
    },
    expect: [],
  });
  return buildScenario('receipt-points.spec.json', scenario);
}

async function run(loaded: LoadedScenario): Promise<Receipt[]> {
  const index = createMemoryIndex([...loaded.observations.values()], 15);
  const policy = loadPolicy(loaded.policyJson);
  const { batchClaims, grants, coverage, activity, fixed } = loaded;
  const graded = await gradeBatch(batchClaims, index, grants, policy, coverage, activity, fixed);
  return graded.map((entry) => entry.receipt);
}

describe('a receipt point inside a purchase window (§6.1)', () => {
  it('makes coverage partial, never full; a point outside the window is none', () => {
    const loaded = load({ claims: [CLAIM] });
    const [claim] = loaded.batchClaims;
    if (claim === undefined) throw new Error('one claim expected');
    const [grant] = loaded.grants;
    if (grant === undefined) throw new Error('one grant expected');
    const levelOf = (entries: readonly ScenarioCoverage[]) =>
      coverageLevel(claim, grant, buildCoverage(entries, EVAL), DEFAULT_POLICY).level;
    expect(levelOf([point(at('14:03'), at('14:10'))])).toBe('partial');
    expect(levelOf([point(at('14:00'), at('14:10')), point(at('14:48'), at('14:50'))])).toBe('partial');
    const everyMinute = Array.from({ length: 49 }, (_, m) =>
      point(`2026-10-06T14:${String(m).padStart(2, '0')}:00-04:00`, at('14:50')),
    );
    expect(levelOf(everyMinute)).toBe('partial');
    expect(levelOf([point(at('13:59'), at('14:10'))])).toBe('none');
  });

  it('never grades a purchase NOT_FOUND on receipts, whatever was read', async () => {
    const other = { ...RECEIPT, ref: 'o2', merchant: 'Uber', amountCents: 1250, occurredAt: at('14:20') };
    const loaded = load({
      claims: [CLAIM],
      observations: [other],
      coverage: [point(at('14:20'), at('14:55'))],
    });
    const [receipt] = await run(loaded);
    expect([receipt?.grade, receipt?.ruleId, receipt?.state]).toEqual([
      'UNVERIFIABLE',
      'partial_coverage',
      'PENDING',
    ]);
  });

  it('lets an exact receipt verify, PENDING until a receipt pass synced at end + graceMin, then FINAL', async () => {
    const early = load({
      claims: [CLAIM],
      observations: [RECEIPT],
      coverage: [point(at('14:03'), at('14:10'))],
    });
    const [pending] = await run(early);
    expect([pending?.grade, pending?.ruleId, pending?.state]).toEqual(['VERIFIED', 'verified', 'PENDING']);
    // The next receipt the user opens, at 14:40, about another message: a receipt pass synced at 14:40 ≥ 14:33.
    const later = load({
      claims: [CLAIM],
      observations: [RECEIPT],
      coverage: [point(at('14:03'), at('14:10')), point(at('09:15'), at('14:40'))],
    });
    const [final] = await run(later);
    expect([final?.grade, final?.ruleId, final?.state]).toEqual(['VERIFIED', 'verified', 'FINAL']);
  });
});

describe('a receipt point and orphans (§3, §7)', () => {
  const loaded = load({ observations: [RECEIPT] });
  const row = loaded.observations.get('o1');
  if (row === undefined) throw new Error('one observation expected');

  it('makes the receipt read at that instant an orphan candidate, and no other', () => {
    const windows = (entries: readonly ScenarioCoverage[]) => seenWindows(buildCoverage(entries, EVAL));
    expect(isOrphanCandidate(row, windows([point(at('14:03'), at('14:10'))]), DEFAULT_POLICY)).toBe(true);
    const next = point('2026-10-06T14:03:00.001-04:00', at('14:10'));
    expect(isOrphanCandidate(row, windows([next]), DEFAULT_POLICY)).toBe(false);
  });

  it('an unclaimed receipt with the usual attribution is UNASKED', async () => {
    const unclaimed = load({
      observations: [RECEIPT],
      coverage: [point(at('14:03'), at('14:10'))],
      activity: {
        sessions: [{ agent: 'muse', at: at('14:00') }],
        idle: [{ from: at('13:55'), to: at('14:10') }],
        adapterSyncs: [{ agent: 'muse', lastSyncAt: at('14:50') }],
      },
    });
    const [receipt, ...rest] = await run(unclaimed);
    expect(rest).toEqual([]);
    expect([receipt?.grade, receipt?.ruleId, receipt?.attribution]).toEqual(['UNASKED', 'unasked', 'likely']);
  });
});

describe('receipt points merge as closed intervals (§3)', () => {
  it('one message read twice is one window; two messages are two', () => {
    const twice = buildCoverage([point(at('14:03'), at('14:10')), point(at('14:03'), at('14:40'))], EVAL);
    expect(seenWindows(twice).bySource.get('gmail.receipt')).toEqual([
      { startMs: Date.parse(at('14:03')), endMs: Date.parse(at('14:03')) },
    ]);
    const two = buildCoverage([point(at('14:03'), at('14:10')), point(at('14:20'), at('14:40'))], EVAL);
    expect(seenWindows(two).bySource.get('gmail.receipt')).toHaveLength(2);
  });

  it('the same pass posted twice hashes once', () => {
    const once = buildCoverage([point(at('14:03'), at('14:10'))], EVAL);
    const twice = buildCoverage([point(at('14:03'), at('14:10')), point(at('14:03'), at('14:10'))], EVAL);
    expect(coverageHash(twice)).toBe(coverageHash(once));
  });
});
