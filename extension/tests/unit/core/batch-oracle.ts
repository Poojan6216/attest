/**
 * The per-claim oracle `gradeBatch` is held to (docs/grading.md §3, §4.1, §4.3, §6.3; Hard Rule 4): each claim
 * receipt of a batch must be `grade()` on that claim's own `candidates()`, minus the observations the batch
 * assigned to other claims (§4.3 `exclusiveCandidates`), with the §6.3 prior spend of the batch's spend history, written out without using scope.ts (tests/property/scope-reference.ts `referencePriorSpend`: never the claim's own id)
 * (`activity.claims` plus any graded claim it omits, a missing currency read as the grant's `spendCurrency`). Replay
 * grades exactly so, so a batch that differs from it cannot be reproduced.
 *
 * Not a test file: the batch fallback, batch history and grade-guard specs share it.
 */
import { type BatchReceipt } from '../../../src/core/batch';
import { candidates, createMemoryIndex } from '../../../src/core/candidates';
import { isAssignable } from '../../../src/core/features';
import { grade } from '../../../src/core/grade';
import { canonicalJson } from '../../../src/core/hash';
import { instantMs } from '../../../src/core/normalize';
import type { Policy } from '../../../src/core/policy';
import type { Activity, Claim, Coverage, Grant, Observation, Receipt, Ulid } from '../../../src/core/schema';
import { referencePriorSpend } from '../../property/scope-reference';

/** One batch's inputs (one grant per agent). */
export interface World {
  readonly claims: readonly Claim[];
  readonly observations: readonly Observation[];
  readonly grants: readonly Grant[];
  readonly policy: Policy;
  readonly coverage: Coverage;
  readonly activity: Activity;
}

const seenBy = <T extends { readonly observedAt: string }>(rows: readonly T[], atMs: number): T[] =>
  rows.filter((row) => instantMs(row.observedAt) <= atMs);

/** §3, §6.3: the spend history: `activity.claims` seen by then, plus each graded claim whose id it omits. */
export function spendHistory(world: World): Claim[] {
  const atMs = instantMs(world.coverage.evaluatedAt);
  const listed = seenBy(world.activity.claims, atMs);
  const ids = new Set(listed.map((claim) => claim.id));
  return [...listed, ...seenBy(world.claims, atMs).filter((claim) => !ids.has(claim.id))];
}

/** The oracle's receipt for `claim`, given the batch's own receipts (for the assignment). */
export async function oracleReceipt(
  world: World,
  graded: readonly BatchReceipt[],
  claim: Claim,
): Promise<Receipt> {
  const { policy, coverage } = world;
  const atMs = instantMs(coverage.evaluatedAt);
  const owners = new Map<Ulid, Ulid>();
  for (const { receipt } of graded) {
    if (receipt.claimId !== undefined)
      for (const id of receipt.observationIds) owners.set(id, receipt.claimId);
  }
  const index = createMemoryIndex(seenBy(world.observations, atMs), 1);
  const found = isAssignable(claim, policy) ? await candidates(claim, index, policy) : [];
  const own = found.filter((observation) => (owners.get(observation.id) ?? claim.id) === claim.id);
  const grant = world.grants.find((held) => held.agent === claim.agent);
  if (grant === undefined) throw new Error(`no grant for ${claim.agent}`);
  const prior = referencePriorSpend(claim, spendHistory(world), policy, grant.spendCurrency);
  return grade(claim, own, grant, policy, coverage, { priorSpendCents: prior });
}

/** Every claim receipt of `graded` against the oracle, as [claim id, batch JSON, oracle JSON] triples. */
export async function againstOracle(
  world: World,
  graded: readonly BatchReceipt[],
): Promise<[Ulid, string, string][]> {
  const out: [Ulid, string, string][] = [];
  for (const claim of world.claims) {
    const batch = graded.find(({ receipt }) => receipt.claimId === claim.id)?.receipt;
    if (batch === undefined) continue;
    const oracle = await oracleReceipt(world, graded, claim);
    out.push([claim.id, canonicalJson(batch), canonicalJson(oracle)]);
  }
  return out;
}
