/**
 * Task 1.5: every golden receipt reproduced by `grade()` alone, in grade mode (docs/grading.md §3, §15).
 *
 * The golden files were written from the contract alone, with every expectation computed by hand. The batch
 * runner (tests/golden/runner.ts) checks them through `gradeBatch`; this spec isolates `grade()` from retrieval,
 * assignment, cumulative spend and attribution, deriving each of those from the files themselves:
 *
 *  - a claim receipt: the claim's §4.1 candidates (core `candidates()` over a memory index) minus the
 *    observations the expectations assign to other claims and those the scenario fixes (§4.3); its §6.3
 *    `priorSpendCents`, recomputed here from `activity.claims`;
 *  - an UNASKED receipt: the orphan alone, with the attribution the expectation states (its `unasked.*` signals,
 *    its `attributionScore`, the agent's latest adapter sync);
 *  - a scope receipt: no candidate and `context.scope`.
 *
 * Each receipt must match grade, ruleId, the pre-override state, observationIds, the ordered reasons (minus the
 * state.ts lifecycle codes), the display score, §6.4 confidence, computedAt/finalAt, and parse with `Receipt`.
 */
import { describe, expect, it } from 'vitest';

import { candidates, createMemoryIndex } from '../../../src/core/candidates';
import { grade } from '../../../src/core/grade';
import { instantMs } from '../../../src/core/normalize';
import { loadPolicy, type Policy } from '../../../src/core/policy';
import { ratio, toDisplay } from '../../../src/core/ratio';
import {
  Attribution,
  type Claim,
  type GradeContext,
  type Grant,
  Receipt,
  type UnaskedSignal,
} from '../../../src/core/schema';
import { BASIS_POINTS, MS_PER_DAY } from '../../../src/core/units';
import { type LoadedScenario, loadScenario, type ResolvedExpect, scenarioFiles } from '../../golden/load';
import { parseFraction } from '../../golden/scenario-schema';

/** The memory index's bucket width: an index tuning parameter (Decisions [1.3]), not policy. */
const BUCKET_MINUTES = 15;
const LIFECYCLE = new Set(['override.user', 'superseded']);
const SIGNALS: Readonly<Record<string, UnaskedSignal>> = {
  'unasked.session': 'agentSessionActive',
  'unasked.idle': 'userIdle',
  'unasked.signature': 'agentSignature',
  'unasked.adjacent': 'activityLogAdjacent',
};

function grantOf(loaded: LoadedScenario, agent: string): Grant {
  const grant = loaded.grants.find((candidate) => candidate.agent === agent);
  if (grant === undefined) throw new Error(`${loaded.file}: no grant for ${agent}`);
  return grant;
}

/** §6.3, recomputed independently: same agent, spend type, same currency, in window, strictly before. */
function priorSpend(loaded: LoadedScenario, claim: Claim, policy: Policy): number {
  const at = instantMs(claim.claimedAt);
  const from = at - policy.windows.spendWindowDays * MS_PER_DAY;
  return loaded.activity.claims
    .filter((other) => {
      const otherAt = instantMs(other.claimedAt);
      const before = otherAt < at || (otherAt === at && other.id < claim.id);
      return (
        other.agent === claim.agent &&
        policy.spendTypes.includes(other.type) &&
        other.currency !== undefined &&
        other.currency === claim.currency &&
        otherAt >= from &&
        before
      );
    })
    .reduce((sum, other) => sum + (other.amountCents ?? 0), 0);
}

/** §4.1 candidates minus what the expectations assign to other claims or the scenario fixes (§4.3). */
async function ownCandidates(loaded: LoadedScenario, ref: string, claim: Claim, policy: Policy) {
  const taken = new Set<string>(loaded.fixed.map((pair) => pair.observationId));
  for (const { expected, observationIds } of loaded.expected) {
    if (expected.ref !== undefined && expected.ref !== ref && expected.ref.startsWith('c')) {
      for (const id of observationIds) taken.add(id);
    }
  }
  const index = createMemoryIndex([...loaded.observations.values()], BUCKET_MINUTES);
  const found = await candidates(claim, index, policy);
  return found.filter((observation) => !taken.has(observation.id));
}

function attributionOf(loaded: LoadedScenario, resolved: ResolvedExpect): Attribution {
  const { expected } = resolved;
  const agent = expected.agent ?? 'muse';
  const fraction = parseFraction(expected.attributionScore ?? '0/1');
  const evaluatedMs = instantMs(loaded.evaluatedAt);
  const syncs = loaded.activity.adapterSyncs
    .filter((sync) => sync.agent === agent && instantMs(sync.lastSyncAt) <= evaluatedMs)
    .sort((a, b) => instantMs(b.lastSyncAt) - instantMs(a.lastSyncAt));
  return Attribution.parse({
    agent,
    scoreBp: Number((fraction.num * BigInt(BASIS_POINTS)) / fraction.den),
    signals: expected.reasonCodes.flatMap((code) => SIGNALS[code] ?? []),
    ...(syncs[0] === undefined ? {} : { adapterLastSyncAt: syncs[0].lastSyncAt }),
  });
}

async function gradeExpectation(loaded: LoadedScenario, resolved: ResolvedExpect, policy: Policy) {
  const { expected } = resolved;
  const context: GradeContext = { priorSpendCents: 0 };
  if (expected.scope !== undefined) {
    const scoped = { ...context, scope: { observed: expected.scope.scope } };
    return grade(null, [], grantOf(loaded, expected.scope.agent), policy, loaded.coverage, scoped);
  }
  const ref = expected.ref ?? '';
  if (ref.startsWith('o')) {
    const orphan = loaded.observations.get(ref);
    if (orphan === undefined) throw new Error(`${loaded.file}: no observation ${ref}`);
    const attribution = attributionOf(loaded, resolved);
    const grant = grantOf(loaded, attribution.agent);
    return grade(null, [orphan], grant, policy, loaded.coverage, { ...context, attribution });
  }
  const claim = loaded.claims.get(ref);
  if (claim === undefined) throw new Error(`${loaded.file}: no claim ${ref}`);
  const own = await ownCandidates(loaded, ref, claim, policy);
  const prior = { priorSpendCents: priorSpend(loaded, claim, policy) };
  return grade(claim, own, grantOf(loaded, claim.agent), policy, loaded.coverage, prior);
}

function expectedConfidence(resolved: ResolvedExpect): number {
  const { expected } = resolved;
  if (expected.grade === 'NOT_FOUND' || expected.grade === 'OVER_SCOPE') return 1;
  const score = expected.grade === 'UNASKED' ? expected.attributionScore : expected.score;
  if (expected.grade === 'UNVERIFIABLE' || score === undefined || score === null) return 0;
  const { num, den } = parseFraction(score);
  return toDisplay(ratio(num, den));
}

function check(loaded: LoadedScenario, resolved: ResolvedExpect, receipt: Receipt): void {
  const { expected } = resolved;
  const label = `${loaded.file} ${expected.ref ?? 'scope'}`;
  expect(Receipt.safeParse(receipt).success, label).toBe(true);
  expect(receipt.id, label).toBe(resolved.receiptId);
  expect([receipt.grade, receipt.ruleId], label).toEqual([expected.grade, expected.ruleId]);
  expect(receipt.state, label).toBe(expected.previousState ?? expected.state);
  expect(receipt.observationIds, label).toEqual(resolved.observationIds);
  const codes = expected.reasonCodes.filter((code) => !LIFECYCLE.has(code));
  expect(
    receipt.reasons.map((reason) => reason.code),
    label,
  ).toEqual(codes);
  if (resolved.reasons !== undefined) {
    expect(receipt.reasons, label).toEqual(resolved.reasons.filter((reason) => !LIFECYCLE.has(reason.code)));
  }
  const score = expected.score === null ? undefined : toDisplay(ratio(...parts(expected.score)));
  expect(receipt.signals.score, label).toBe(score);
  expect(receipt.confidence, label).toBe(expectedConfidence(resolved));
  expect(receipt.computedAt, label).toBe(loaded.evaluatedAt);
  expect(receipt.finalAt, label).toBe(receipt.state === 'FINAL' ? loaded.evaluatedAt : undefined);
  if (expected.agent !== undefined) expect(receipt.agent, label).toBe(expected.agent);
  if (expected.grade === 'UNASKED') expect(receipt.attribution, label).toBe('likely');
}

function parts(fraction: string): [bigint, bigint] {
  const { num, den } = parseFraction(fraction);
  return [num, den];
}

const FILES = scenarioFiles();

describe('golden receipts in grade mode (task 1.5)', () => {
  it('reads the whole golden suite', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(FILES)('%s: grade() reproduces every expected receipt', async (file) => {
    const loaded = loadScenario(file);
    const policy = loadPolicy(loaded.policyJson);
    for (const resolved of loaded.expected) {
      check(loaded, resolved, await gradeExpectation(loaded, resolved, policy));
    }
  });

  it('the §2 demo: email VERIFIED (12/13), calendar NOT_FOUND after grace, orphan UNASKED (13)', async () => {
    const loaded = loadScenario('13-demo-section-2.json');
    const policy = loadPolicy(loaded.policyJson);
    const receipts = await Promise.all(loaded.expected.map((r) => gradeExpectation(loaded, r, policy)));
    expect(receipts.map((r) => [r.grade, r.ruleId, r.state])).toEqual([
      ['VERIFIED', 'verified', 'FINAL'],
      ['NOT_FOUND', 'not_found', 'FINAL'],
      ['UNASKED', 'unasked', 'FINAL'],
    ]);
    expect(receipts[0]?.signals.score).toBe(toDisplay(ratio(12, 13)));
    expect(receipts[2]?.reasons.filter((r) => r.code.startsWith('unasked.')).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('the §2 demo without calendar coverage: the calendar claim is UNVERIFIABLE, never NOT_FOUND (14)', async () => {
    const loaded = loadScenario('14-demo-calendar-coverage-absent.json');
    const policy = loadPolicy(loaded.policyJson);
    const receipts = await Promise.all(loaded.expected.map((r) => gradeExpectation(loaded, r, policy)));
    expect(receipts.map((r) => [r.grade, r.ruleId, r.state])).toEqual([
      ['VERIFIED', 'verified', 'FINAL'],
      ['UNVERIFIABLE', 'no_coverage', 'PENDING'],
      ['UNASKED', 'unasked', 'FINAL'],
    ]);
  });
});
