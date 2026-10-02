/**
 * The receipt inputs gradeBatch returns (docs/grading.md §3 v1.4: `{receipt, inputs: {grant, context,
 * policyHash}}`, coverage being the batch's own), checked on every receipt of every batch grading:
 *
 *  - `policyHash` is the loaded policy's;
 *  - `grant` is the grant in force for the receipt's agent: the latest `updatedAt ≤ evaluatedAt` (§3);
 *  - `context` has the shape of the receipt's subject: no attribution or scope for a claim, the attributed
 *    agent's attribution for an UNASKED orphan, the observed scope for a scope-diff receipt (§3, §6.1, §7);
 *  - **replay**: `grade(subject, candidates, inputs.grant, policy, coverage, inputs.context)` gives back the very
 *    same receipt (§9), where the candidates are the claim's §4.1 candidates as of `evaluatedAt` minus those
 *    assigned to other claims, fixed or taken (§4.3; none for a claim that is not assignable), `[the orphan]` for
 *    UNASKED and `[]` for a scope subject. So the stored inputs are exactly what produced the receipt (HR4).
 */
import { candidates, createMemoryIndex } from '../../src/core/candidates';
import { isAssignable } from '../../src/core/features';
import { grade } from '../../src/core/grade';
import { canonicalJson } from '../../src/core/hash';
import { instantMs } from '../../src/core/normalize';
import type { Policy } from '../../src/core/policy';
import { grantHash } from '../../src/core/receipt';
import type {
  Claim,
  Coverage,
  GradeContext,
  Grant,
  IsoTs,
  Observation,
  Receipt,
  Ulid,
} from '../../src/core/schema';
import type { LoadedScenario } from './load';

/** The memory index's bucket width: an index tuning parameter (Decisions [1.3]), not policy. */
export const RUNNER_BUCKET_MINUTES = 15;

/** What a receipt was graded with (§3 v1.4). */
export interface GradedInputs {
  readonly grant: Grant;
  readonly context: GradeContext;
  readonly policyHash: string;
}

/** One receipt as graded, with its inputs. */
export interface Graded {
  readonly receipt: Receipt;
  readonly inputs: GradedInputs;
}

/** One grading of the scenario at one instant: the first one, or a `regrade` event's (§8). */
export interface Pass {
  readonly evaluatedAt: IsoTs;
  readonly coverage: Coverage;
  /** True for gradeBatch; false for the grade-mode call, whose inputs are the runner's own. */
  readonly batch: boolean;
  readonly entries: readonly Graded[];
}

/** The agent's grant in force at `evaluatedAt` (§3 v1.4), or undefined. Ties are the batch's to reject. */
export function grantInForceAt(
  grants: readonly Grant[],
  agent: string,
  evaluatedAt: string,
): Grant | undefined {
  const limit = instantMs(evaluatedAt);
  let best: Grant | undefined;
  for (const grant of grants) {
    if (grant.agent !== agent || instantMs(grant.updatedAt) > limit) continue;
    if (best === undefined || instantMs(grant.updatedAt) > instantMs(best.updatedAt)) best = grant;
  }
  return best;
}

/** Observations first seen by `evaluatedAt` (§3): the only ones a grading at that instant may read. */
export function visibleObservations(loaded: LoadedScenario, evaluatedAt: string): Observation[] {
  const limit = instantMs(evaluatedAt);
  return [...loaded.observations.values()].filter((o) => instantMs(o.observedAt) <= limit);
}

/** The orphan row an UNASKED receipt names: the earliest sighting of its id (§4.1 dedupe). */
function orphanRow(visible: readonly Observation[], id: string): Observation | undefined {
  const rows = visible.filter((o) => o.id === id);
  return rows.sort((a, b) => instantMs(a.observedAt) - instantMs(b.observedAt))[0];
}

/** §4.3: the claim's candidates for `grade`, as of the pass. */
async function claimCandidates(
  loaded: LoadedScenario,
  policy: Policy,
  pass: Pass,
  claim: Claim,
): Promise<Observation[]> {
  if (!isAssignable(claim, policy)) return [];
  const index = createMemoryIndex(visibleObservations(loaded, pass.evaluatedAt), RUNNER_BUCKET_MINUTES);
  const elsewhere = new Set<Ulid>(loaded.fixed.map((pair) => pair.observationId));
  for (const { receipt } of pass.entries) {
    if (receipt.claimId !== undefined && receipt.claimId !== claim.id)
      for (const id of receipt.observationIds) elsewhere.add(id);
  }
  return (await candidates(claim, index, policy)).filter((o) => !elsewhere.has(o.id));
}

type Subject = { claim: Claim; candidates: Observation[] } | { claim: null; candidates: Observation[] };

async function subjectOf(loaded: LoadedScenario, policy: Policy, pass: Pass, receipt: Receipt) {
  if (receipt.claimId !== undefined) {
    const claim = [...loaded.claims.values()].find((c) => c.id === receipt.claimId);
    if (claim === undefined) return 'names a claim that is not in the scenario';
    return { claim, candidates: await claimCandidates(loaded, policy, pass, claim) } satisfies Subject;
  }
  const orphanId = receipt.observationIds[0];
  if (orphanId === undefined) return { claim: null, candidates: [] } satisfies Subject;
  const orphan = orphanRow(visibleObservations(loaded, pass.evaluatedAt), orphanId);
  if (orphan === undefined) return 'names an orphan not visible at evaluatedAt';
  return { claim: null, candidates: [orphan] } satisfies Subject;
}

/** The context has the shape of the receipt's subject (§3, §6.1, §7). */
function contextProblems(receipt: Receipt, context: GradeContext): string[] {
  const kind =
    receipt.claimId !== undefined ? 'claim' : receipt.observationIds.length > 0 ? 'orphan' : 'scope';
  const problems: string[] = [];
  if ((context.scope !== undefined) !== (kind === 'scope')) problems.push('context.scope ⇔ a scope subject');
  if (kind === 'claim' && context.attribution !== undefined)
    problems.push('a claim context has no attribution');
  if (kind === 'orphan' && context.attribution?.agent !== receipt.agent)
    problems.push("an UNASKED context holds the attributed agent's attribution");
  return problems;
}

/** Every disagreement between one batch entry and the contract; `name` turns a receipt id into a subject ref. */
async function entryProblems(
  loaded: LoadedScenario,
  policy: Policy,
  pass: Pass,
  { receipt, inputs }: Graded,
): Promise<string[]> {
  const problems: string[] = [];
  if (inputs.policyHash !== policy.policyHash) problems.push('policyHash is not the policy’s');
  const inForce = grantInForceAt(loaded.grants, receipt.agent, pass.evaluatedAt);
  if (inForce === undefined || grantHash(inputs.grant) !== grantHash(inForce))
    problems.push(`grant is not ${receipt.agent}'s grant in force (latest updatedAt ≤ evaluatedAt)`);
  problems.push(...contextProblems(receipt, inputs.context));
  const subject = await subjectOf(loaded, policy, pass, receipt);
  if (typeof subject === 'string') return [...problems, subject];
  try {
    const again = grade(
      subject.claim,
      subject.candidates,
      inputs.grant,
      policy,
      pass.coverage,
      inputs.context,
    );
    if (canonicalJson(again) !== canonicalJson(receipt))
      problems.push('grade() on the returned inputs does not give back the receipt (replay, §9)');
  } catch (error) {
    problems.push(`grade() on the returned inputs throws: ${String(error)}`);
  }
  return problems;
}

/** The inputs problems of every receipt of a batch pass, as `<subject> inputs at <evaluatedAt>: …` lines. */
export async function passProblems(
  loaded: LoadedScenario,
  policy: Policy,
  pass: Pass,
  name: (receiptId: string) => string,
): Promise<string[]> {
  if (!pass.batch) return [];
  const lines: string[] = [];
  for (const entry of pass.entries) {
    const label = `${name(entry.receipt.id)} inputs at ${pass.evaluatedAt}`;
    for (const problem of await entryProblems(loaded, policy, pass, entry))
      lines.push(`${label}: ${problem}`);
  }
  return lines;
}
