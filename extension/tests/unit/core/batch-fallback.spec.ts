/**
 * The two batch paths no well-formed ledger or default-like policy reaches, run and pinned to the per-claim oracle
 * (batch-oracle.ts: `grade()` on `candidates()`; Hard Rule 4):
 *
 *  - QA-R5, batch-retrieve.ts `claimByClaim`: one `contentHash` at two `occurredAt` instants (only a forged or
 *    imported ledger holds that: `contentHash` binds `occurredAt`, §10) sends the type's claims through
 *    `candidates()` one by one. Every claim's candidates are then exactly `candidates()`'s, the receipts the
 *    oracle's, and replay reports the row whose content no longer hashes to its `contentHash`.
 *  - QA-R6, batch-score.ts's BigInt scores: with `calendarDays` of a million days, a timeProximity denominator
 *    near 8.6e13 ms makes the weighted sum leave the safe integers, so pairs are scored and compared as BigInt
 *    Ratios (assignment and the best candidate alike). The receipts are still the oracle's.
 */
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { gradeBatch } from '../../../src/core/batch';
import { candidatesOfAll } from '../../../src/core/batch-retrieve';
import { scoreClaim } from '../../../src/core/batch-score';
import { candidates, createMemoryIndex } from '../../../src/core/candidates';
import { TextFacts } from '../../../src/core/features';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../../src/core/policy';
import { replay, type ReceiptInputs } from '../../../src/core/replay';
import { contentHashOf } from '../../../src/core/replay-compare';
import { Activity, type Claim, type Grant, IsoTs, type Observation } from '../../../src/core/schema';
import {
  buildClaim,
  buildCoverage,
  buildGrant,
  buildObservation,
  mergePatch,
  PolicyView,
} from '../../golden/build';
import { ScenarioClaim, ScenarioObservation } from '../../golden/scenario-schema';
import { againstOracle, type World } from './batch-oracle';

const at = (hhmm: string, day = '06'): string => `2026-10-${day}T${hhmm}:00-04:00`;
const EVAL = at('15:00');
const VIEW = PolicyView.parse(defaultPolicyJson);
const GRANT: Grant = buildGrant({ agent: 'muse' }, EVAL);

const claimOf = (over: Record<string, unknown>): Claim =>
  buildClaim(ScenarioClaim.parse({ agent: 'muse', type: 'email.sent', ...over }));
const obsOf = (over: Record<string, unknown>): Observation =>
  buildObservation(
    ScenarioObservation.parse({ source: 'gmail.sent', type: 'email.sent', ...over }),
    [],
    EVAL,
    VIEW,
  );

function worldOf(claims: readonly Claim[], observations: readonly Observation[], policy: Policy): World {
  const coverage = buildCoverage(
    [
      { source: 'gmail.sent', lastSyncAt: EVAL, windowStart: at('09:00'), windowEnd: EVAL, accountHash: 'a' },
      {
        source: 'gcal.event',
        lastSyncAt: EVAL,
        windowStart: at('09:00'),
        windowEnd: EVAL,
        accountHash: 'a',
        allCalendars: true,
      },
    ],
    EVAL,
  );
  const activity = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims });
  return { claims, observations, grants: [GRANT], policy, coverage, activity };
}

async function graded(world: World) {
  const index = createMemoryIndex(world.observations, 1);
  const { claims, grants, policy, coverage, activity } = world;
  return gradeBatch(claims, index, grants, policy, coverage, activity);
}

/** Two claims and three rows, one of them a forged copy of o1 moved to 14:35 (same id and contentHash). */
function forgedWorld() {
  const a = claimOf({ ref: 'c1', counterparty: 'priya@company.com', claimedAt: at('14:02') });
  const b = claimOf({ ref: 'c2', counterparty: 'priya@company.com', claimedAt: at('14:30') });
  const o1 = obsOf({
    ref: 'o1',
    counterparty: 'priya@company.com',
    occurredAt: at('14:02'),
    observedAt: at('14:10'),
  });
  const moved: Observation = {
    ...o1,
    occurredAt: IsoTs.parse(at('14:35')),
    observedAt: IsoTs.parse(at('14:40')),
  };
  const o2 = obsOf({
    ref: 'o2',
    counterparty: 'raj@company.com',
    occurredAt: at('14:31'),
    observedAt: at('14:40'),
  });
  return { a, b, o1, moved, world: worldOf([a, b], [moved, o1, o2], DEFAULT_POLICY) };
}

describe('QA-R5: one contentHash at two instants takes the claim-by-claim path, and it is candidates() exactly', () => {
  it('every claim gets candidates() itself, in its order, from one table of the rows returned', async () => {
    const { a, b, o1, moved, world } = forgedWorld();
    const index = createMemoryIndex(world.observations, 1);
    const found = await candidatesOfAll(
      [a, b],
      index,
      DEFAULT_POLICY,
      new TextFacts(DEFAULT_POLICY.normalize.stopWords),
    );
    for (const claim of [a, b]) {
      const own = found.get(claim);
      const rows = (own?.rows ?? []).map((row) => own?.table.rows[row]);
      expect(rows).toEqual(await candidates(claim, index, DEFAULT_POLICY));
    }
    // A grouped table holds one row per contentHash: two rows of one hash mean the claim-by-claim path ran.
    const table = found.get(a)?.table.rows ?? [];
    expect(table).toContain(o1);
    expect(table).toContain(moved);
  });

  it('gradeBatch gives the oracle receipt for every claim', async () => {
    const { world } = forgedWorld();
    const pairs = await againstOracle(world, await graded(world));
    expect(pairs).toHaveLength(2);
    for (const [id, batch, oracle] of pairs) expect(batch, id).toBe(oracle);
  });

  it('replay reports the forged row: its content no longer hashes to its contentHash', async () => {
    const { moved, world } = forgedWorld();
    const results = await graded(world);
    const receiptInputs = new Map<string, ReceiptInputs>(
      results.map(({ receipt, inputs }) => [receipt.inputsHash, { ...inputs, coverage: world.coverage }]),
    );
    const report = await replay({
      claims: world.claims,
      observations: world.observations,
      receipts: results.map(({ receipt }) => receipt),
      receiptInputs,
      policies: new Map([[DEFAULT_POLICY.policyHash, DEFAULT_POLICY]]),
    });
    const flagged = report.mismatches.filter((mismatch) => mismatch.field === 'contentHash');
    expect(flagged.length).toBeGreaterThan(0);
    for (const mismatch of flagged) expect(mismatch.replayed).toBe(contentHashOf(moved));
  });
});

/** Calendar claims and events a few hours off their targets: a million-day window leaves the safe integers. */
function wideWorld() {
  const policy = loadPolicy(mergePatch(defaultPolicyJson, { windows: { calendarDays: 1_000_000 } }));
  const event = (ref: string, subjectHint: string, occurredAt: string) =>
    obsOf({
      ref,
      source: 'gcal.event',
      type: 'calendar.updated',
      subjectHint,
      occurredAt,
      observedAt: at('14:50'),
    });
  const claim = (ref: string, subjectHint: string, targetAt: string) =>
    claimOf({ ref, type: 'calendar.updated', subjectHint, targetAt, claimedAt: at('14:02') });
  const claims = [
    claim('c1', 'Q3 planning sync', at('10:00', '08')),
    claim('c2', 'Q3 planning', at('13:00', '08')),
  ];
  const observations = [
    event('o1', 'Q3 planning sync', at('10:07', '08')),
    event('o2', 'Q3 planning review', at('12:41', '08')),
    event('o3', 'planning sync', at('13:13', '08')),
    event('o4', 'Hiring plan', at('09:59', '08')),
  ];
  return worldOf(claims, observations, policy);
}

describe('QA-R6: scores beyond the safe integers are compared as BigInt Ratios, as grade() compares them', () => {
  it('the extreme policy reaches the BigInt branch for several pairs of every claim', async () => {
    const world = wideWorld();
    const index = createMemoryIndex(world.observations, 1);
    const texts = new TextFacts(world.policy.normalize.stopWords);
    const found = await candidatesOfAll(world.claims, index, world.policy, texts);
    for (const claim of world.claims) {
      const own = found.get(claim);
      if (own === undefined) throw new Error('every claim here is assignable');
      const scored = scoreClaim(claim, own, world.policy, null);
      // At least two BigInt pairs per claim, so the best candidate is chosen by comparing two Ratios.
      expect(scored.big.size, claim.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('gradeBatch gives the oracle receipt for every claim (assignment and best candidate in BigInt)', async () => {
    const world = wideWorld();
    const results = await graded(world);
    const pairs = await againstOracle(world, results);
    expect(pairs).toHaveLength(2);
    for (const [id, batch, oracle] of pairs) expect(batch, id).toBe(oracle);
    const assigned = results.flatMap(({ receipt }) => receipt.observationIds);
    expect(assigned.length).toBeGreaterThan(0);
  });
});
