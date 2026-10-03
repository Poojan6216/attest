/**
 * Replay at the instants where a batch and its replay can part (docs/grading.md §3, §4.1, §4.3, §9; Hard Rule 4),
 * each ledger graded by gradeBatch the way the background grades it and replayed with 0 mismatches expected:
 *  - an override stamped just after a batch's evaluatedAt but read by that batch (the race), or stamped at the very
 *    millisecond of a batch (the tie): batch-fixed.ts, on both sides, releases or takes an observation only in
 *    batches evaluated strictly after the override's `at`, and keeps a claim overridden from PENDING fixed to its
 *    stored evidence in every batch after its last grading (Sprint 1 close);
 *  - a claim first read at exactly a batch's evaluatedAt: that batch grades it (`observedAt ≤ evaluatedAt`), and
 *    replay rebuilds that batch with it;
 *  - a calendar.created event first seen exactly at the claim's first-seen bound: a candidate (`observedAt ≥ bound`)
 *    for the batch and for replay alike.
 */
import { describe, expect, it } from 'vitest';

import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { loadPolicy } from '../../../src/core/policy';
import { type LedgerSnapshot, replay } from '../../../src/core/replay';
import { IsoTs, type Receipt } from '../../../src/core/schema';
import { buildScenario } from '../../golden/load';
import { Scenario } from '../../golden/scenario-schema';
import { LedgerSim } from '../../tools/attest-ledger';
import {
  CLAIMS,
  OBSERVATIONS,
  receiptIdOf,
  type ReceiptRef,
  scenarioWorld,
  T1,
  T2,
  T2_MS,
} from '../../tools/attest-scenario';
import { buildClaim, isoAt, MS_PER_DAY, type World } from '../../tools/attest-world';

/** `ms` as an IsoTs at UTC. */
const iso = (ms: number): IsoTs => IsoTs.parse(isoAt(ms, 0));

/** The scenario world (or `world`) graded at T1, then `between(sim)`, then graded at T2. */
async function ledger(between: (sim: LedgerSim) => void, world: World = scenarioWorld()): Promise<LedgerSim> {
  const sim = new LedgerSim(world);
  const { policy } = world.policyAt(0);
  await sim.grade(T1, policy);
  between(sim);
  await sim.grade(T2, policy);
  return sim;
}

function stored(snapshot: LedgerSnapshot, ref: ReceiptRef): Receipt {
  const found = snapshot.receipts.find((receipt) => receipt.id === receiptIdOf(ref));
  if (found === undefined) throw new Error(`no receipt for ${ref}`);
  return found;
}

/** [grade, state, computedAt as T1/T2, observation ids]. */
function row(snapshot: LedgerSnapshot, ref: ReceiptRef) {
  const { grade, state, computedAt, observationIds } = stored(snapshot, ref);
  return [grade, state, computedAt === T1 ? 'T1' : computedAt === T2 ? 'T2' : computedAt, observationIds];
}

async function expectReplayed(snapshot: LedgerSnapshot): Promise<void> {
  const report = await replay(snapshot);
  expect(report.mismatches).toEqual([]);
  expect(report.reproduced).toBe(snapshot.receipts.length);
}

describe('an override stamped after a batch’s evaluatedAt but read by that batch (the race)', () => {
  it('c7 overridden to NOT_FOUND at T2 + 5 ms, before batch T2 reads it: c7 still holds o7 at T2', async () => {
    const sim = await ledger((s) => {
      s.override(receiptIdOf('c7'), 'NOT_FOUND', iso(T2_MS + 5));
    });
    const snapshot = sim.snapshot();
    expect(stored(snapshot, 'c7').override).toMatchObject({ grade: 'NOT_FOUND', previousState: 'FINAL' });
    expect(row(snapshot, 'c8')).toEqual(['NOT_FOUND', 'FINAL', 'T2', []]);
    await expectReplayed(snapshot);
  });

  it('c5 (PENDING) and u9 overridden to VERIFIED at T2 + 5 ms: c5 keeps o5 at T2, and batch T3 grades', async () => {
    const sim = await ledger((s) => {
      s.override(receiptIdOf('c5'), 'VERIFIED', iso(T2_MS + 5));
      s.override(receiptIdOf('u9'), 'VERIFIED', iso(T2_MS + 5));
    });
    // c5 is no longer PENDING when batch T2 reads it, so T2 leaves it out and keeps its stored o5 fixed to it (it was
    // never graded after T1). Left free, c6 would take o5 FINAL at T2 and batch T3 would find o5 fixed to two claims.
    // u9 takes o9 only after its `at`, so c10 takes o9 at T2.
    const snapshot = sim.snapshot();
    expect(row(snapshot, 'c5')).toEqual(['VERIFIED', 'USER_OVERRIDDEN', 'T1', [OBSERVATIONS.o5.id]]);
    expect(row(snapshot, 'c6')).toEqual(['NOT_FOUND', 'FINAL', 'T2', []]);
    expect(row(snapshot, 'c10')).toEqual(['VERIFIED', 'FINAL', 'T2', [OBSERVATIONS.o9.id]]);
    await expectReplayed(snapshot);
    await sim.grade(iso(T2_MS + MS_PER_DAY), sim.world.policyAt(0).policy);
    await expectReplayed(sim.snapshot());
  });
});

describe('an override stamped at the very millisecond of a batch (the tie)', () => {
  it('c1 (FINAL since T1) overridden to NOT_FOUND at T2, after batch T2 ran: replays as it was graded', async () => {
    const sim = await ledger(() => undefined);
    const before = sim.snapshot();
    expect(row(before, 'c2')).toEqual(['NOT_FOUND', 'FINAL', 'T2', []]);
    await expectReplayed(before);
    sim.override(receiptIdOf('c1'), 'NOT_FOUND', T2);
    await expectReplayed(sim.snapshot());
  });

  it('the same override 1 ms later, and one at T2 read before batch T2, replay too', async () => {
    const later = await ledger(() => undefined);
    later.override(receiptIdOf('c1'), 'NOT_FOUND', iso(T2_MS + 1));
    await expectReplayed(later.snapshot());
    const read = await ledger((s) => {
      s.override(receiptIdOf('c1'), 'NOT_FOUND', T2);
    });
    // Read by batch T2 but not in force there: o1 stays with c1, so c2 is still NOT_FOUND.
    expect(row(read.snapshot(), 'c2')).toEqual(['NOT_FOUND', 'FINAL', 'T2', []]);
    await expectReplayed(read.snapshot());
  });

  it('c5 (PENDING) overridden to VERIFIED at T2, read by batch T2: o5 stays c5’s there and after', async () => {
    const sim = await ledger((s) => {
      s.override(receiptIdOf('c5'), 'VERIFIED', T2);
    });
    expect(row(sim.snapshot(), 'c6')).toEqual(['NOT_FOUND', 'FINAL', 'T2', []]);
    await expectReplayed(sim.snapshot());
    await sim.grade(iso(T2_MS + MS_PER_DAY), sim.world.policyAt(0).policy);
    await expectReplayed(sim.snapshot());
  });
});

describe('a claim first read exactly at a batch’s evaluatedAt is in that batch (§3)', () => {
  it('a vague claim read at T1 is UNVERIFIABLE and FINAL at T1, and replays', async () => {
    const base = scenarioWorld();
    const c13 = buildClaim(13, {
      agent: 'muse',
      type: 'email.sent',
      claimedAt: CLAIMS.c12.claimedAt,
      observedAt: T1,
    });
    const sim = await ledger(() => undefined, { ...base, claims: [...base.claims, c13] });
    const snapshot = sim.snapshot();
    const r13 = snapshot.receipts.find((receipt) => receipt.claimId === c13.id);
    expect(r13).toMatchObject({
      grade: 'UNVERIFIABLE',
      ruleId: 'underspecified',
      state: 'FINAL',
      computedAt: T1,
    });
    await expectReplayed(snapshot);
  });

  it('c3 read at T1 takes o3 from c4 at T1: c4 is NOT_FOUND and FINAL there, and both replay', async () => {
    const base = scenarioWorld();
    const c3 = buildClaim(3, { ...CLAIMS.c3, observedAt: T1 });
    expect(c3.id).toBe(CLAIMS.c3.id);
    const world = { ...base, claims: base.claims.map((claim) => (claim.id === c3.id ? c3 : claim)) };
    const snapshot = (await ledger(() => undefined, world)).snapshot();
    expect(row(snapshot, 'c4')).toEqual(['NOT_FOUND', 'FINAL', 'T1', []]);
    expect(row(snapshot, 'c3')).toEqual(['VERIFIED', 'FINAL', 'T2', [OBSERVATIONS.o3.id]]);
    await expectReplayed(snapshot);
  });
});

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const PASS = {
  lastSyncAt: EVALUATED_AT,
  windowStart: '2026-10-06T12:00:00-04:00',
  windowEnd: EVALUATED_AT,
  accountHash: 'acct-a',
} as const;

describe('a calendar.created event first seen exactly at the first-seen bound (§4.1)', () => {
  it('is a candidate for gradeBatch and for replay: VERIFIED and FINAL, 0 mismatches', async () => {
    // A 14:02 minute claim: the bound is start(p,t) − beforeClaimMin = 14:00:00.000, the event's first sighting.
    const scenario = Scenario.parse({
      name: 'first seen at the bound',
      covers: ['test:replay'],
      mode: 'batch',
      policyPatch: {},
      input: {
        evaluatedAt: EVALUATED_AT,
        claims: [
          {
            ...{ ref: 'c1', agent: 'muse', type: 'calendar.created', counterparty: 'pat@acme.io' },
            ...{ subjectHint: 'Q3 review', claimedAt: '2026-10-06T14:02:00-04:00' },
            ...{ targetAt: '2026-10-08T14:00:00-04:00', observedAt: '2026-10-06T14:10:00-04:00' },
          },
        ],
        observations: [
          {
            ...{ ref: 'o1', source: 'gcal.event', type: 'calendar.created', counterparty: 'pat@acme.io' },
            ...{ subjectHint: 'Q3 review', occurredAt: '2026-10-08T14:00:00-04:00' },
            observedAt: '2026-10-06T14:00:00.000-04:00',
          },
        ],
        grants: [{ agent: 'muse' }],
        coverage: [{ source: 'gcal.event', allCalendars: true, ...PASS }],
      },
      expect: [],
    });
    const loaded = buildScenario('replay-boundaries.spec.json', scenario);
    const policy = loadPolicy(loaded.policyJson);
    const observations = [...loaded.observations.values()];
    const { batchClaims, grants, coverage, activity, fixed } = loaded;
    const index = createMemoryIndex(observations, 15);
    const graded = await gradeBatch(batchClaims, index, grants, policy, coverage, activity, fixed);
    const receipts = graded.map(({ receipt }) => receipt);
    expect(receipts.map((r) => [r.grade, r.ruleId, r.state, r.observationIds.length])).toEqual([
      ['VERIFIED', 'verified', 'FINAL', 1],
    ]);
    const receiptInputs = new Map(
      graded.map(({ receipt, inputs }) => [receipt.inputsHash, { coverage, ...inputs }]),
    );
    const claims = [...loaded.claims.values()];
    const policies = new Map([[policy.policyHash, policy]]);
    await expectReplayed({ claims, observations, receipts, receiptInputs, policies });
  });
});
