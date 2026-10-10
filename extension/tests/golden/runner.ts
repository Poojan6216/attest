/**
 * The golden runner (tests/golden/README.md "Runner contract"; docs/grading.md §15). It calls the core exactly
 * as the contract says:
 *
 *  - batch: `gradeBatch(batchClaims, createMemoryIndex(observations), grants, policy, coverage, activity, fixed)`,
 *    which returns `{receipt, inputs: {grant, context, policyHash}}[]` (§3 v1.4);
 *  - grade: `grade(call.claim, call.candidates, grantInForce(call.agent), policy, coverage, context)`, where context
 *    is the call's context plus, for a claim-less call with activity, `attribute(candidates[0], activity, …)`;
 *
 * then applies the scenario's events with `transition()` (§8): `override` and `supersede` as given, `regrade` by
 * grading the same inputs again at the event's instant and installing the subject's new receipt (or deleting a
 * PENDING UNASKED receipt the new grading no longer returns, §7). An event marked `rejected` must throw
 * IllegalTransitionError and change nothing. Every batch grading's inputs are checked (runner-inputs.ts), and
 * runner-diff.ts compares the result with the expectations.
 */
import { attribute } from '../../src/core/attribution';
import { gradeBatch } from '../../src/core/batch';
import { createMemoryIndex } from '../../src/core/candidates';
import { grade } from '../../src/core/grade';
import { loadPolicy, type Policy } from '../../src/core/policy';
import type { Ratio } from '../../src/core/ratio';
import type { GradeContext, IsoTs, Receipt, Ulid } from '../../src/core/schema';
import { IllegalTransitionError, transition } from '../../src/core/state';
import { type BuiltEvent, type BuiltGradeCall, coverageAt, type LoadedScenario, receiptIdFor } from './load';
import {
  type Graded,
  type GradedInputs,
  grantInForceAt,
  type Pass,
  passProblems,
  RUNNER_BUCKET_MINUTES,
} from './runner-inputs';

export { RUNNER_BUCKET_MINUTES } from './runner-inputs';

/** Where a receipt's current version came from: the grading instant and its inputs. */
export interface Source {
  readonly evaluatedAt: IsoTs;
  readonly inputs: GradedInputs;
}

export interface ScenarioRun {
  readonly policy: Policy;
  /** The receipts after the scenario's events. */
  readonly receipts: readonly Receipt[];
  /** Per receipt id: the grading that produced its current version (the first pass, or its last regrade). */
  readonly sources: ReadonlyMap<Ulid, Source>;
  /** Every grading run: the first, then one per distinct regrade instant. */
  readonly passes: readonly Pass[];
  /** Events that could not be applied as stated, and inputs that disagree with the contract. */
  readonly problems: readonly string[];
}

function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}

/** A reduced "p/q" fraction, as the scenario files write scores. */
export function fractionOf(value: Ratio): string {
  const divisor = gcd(value.num < 0n ? -value.num : value.num, value.den);
  return `${String(value.num / divisor)}/${String(value.den / divisor)}`;
}

/** Ids → refs, so a diff names `c1` and `o2` instead of 26-character ids. */
export interface Names {
  readonly ref: (id: string) => string;
  readonly subject: (receiptId: string) => string;
  /** §3: the claim a receipt id belongs to (`{k:'claim'}` subjects), else undefined (UNASKED, scope). */
  readonly claimId: (receiptId: string) => string | undefined;
}

export function namesOf(loaded: LoadedScenario): Names {
  const refs = new Map<string, string>();
  const subjects = new Map<string, string>();
  const claimIds = new Map<string, string>();
  for (const [ref, claim] of loaded.claims) {
    refs.set(claim.id, ref);
    const receiptId = receiptIdFor({ k: 'claim', claimId: claim.id });
    subjects.set(receiptId, ref);
    claimIds.set(receiptId, claim.id);
  }
  for (const [ref, observation] of loaded.observations) {
    if (!refs.has(observation.id)) refs.set(observation.id, ref);
    const receiptId = receiptIdFor({ k: 'unasked', observationId: observation.id });
    if (!subjects.has(receiptId)) subjects.set(receiptId, ref);
  }
  for (const grant of loaded.grants) {
    for (const scope of grant.observedScopes ?? []) {
      subjects.set(receiptIdFor({ k: 'scope', agent: grant.agent, scope }), `scope ${grant.agent}/${scope}`);
    }
  }
  return {
    ref: (id) => refs.get(id) ?? id,
    subject: (receiptId) => subjects.get(receiptId) ?? `receipt ${receiptId}`,
    claimId: (receiptId) => claimIds.get(receiptId),
  };
}

/** The grade-mode call (§15): its context, with the attribution the contract asks for when activity is given. */
function runGrade(loaded: LoadedScenario, call: BuiltGradeCall, policy: Policy): Graded {
  const orphan = call.candidates[0];
  const attribution =
    call.attributeFromActivity && orphan !== undefined
      ? attribute(orphan, loaded.activity, policy, loaded.evaluatedAt)
      : null;
  const context: GradeContext = attribution === null ? call.context : { ...call.context, attribution };
  const grant = grantInForceAt(loaded.grants, call.agent, loaded.evaluatedAt);
  if (grant === undefined) throw new Error(`golden runner: no grant of ${call.agent} in force`);
  const receipt = grade(call.claim, call.candidates, grant, policy, loaded.coverage, context);
  return { receipt, inputs: { grant, context, policyHash: policy.policyHash } };
}

/** gradeBatch over the scenario's inputs as of `evaluatedAt` (§3: each input is filtered by that instant). */
async function batchAt(loaded: LoadedScenario, policy: Policy, evaluatedAt: IsoTs): Promise<Pass> {
  const coverage = evaluatedAt === loaded.evaluatedAt ? loaded.coverage : coverageAt(loaded, evaluatedAt);
  const results = await gradeBatch(
    loaded.batchClaims,
    createMemoryIndex([...loaded.observations.values()], RUNNER_BUCKET_MINUTES),
    loaded.grants,
    policy,
    coverage,
    loaded.activity,
    loaded.fixed,
    loaded.modelScores,
  );
  const entries = results.map(({ receipt, inputs }): Graded => {
    const { grant, context, policyHash } = inputs;
    return { receipt, inputs: { grant, context, policyHash } };
  });
  return { evaluatedAt, coverage, batch: true, entries };
}

/** The mutable state the events act on. */
interface EventState {
  readonly byId: Map<Ulid, Receipt>;
  readonly sources: Map<Ulid, Source>;
  readonly problems: string[];
}

/** Runs `apply`; a `rejected` event must throw IllegalTransitionError (then nothing changes), any other must not. */
function attempt(state: EventState, event: BuiltEvent, label: string, apply: () => Receipt): boolean {
  try {
    const next = apply();
    if (event.rejected) {
      state.problems.push(`${label}: expected IllegalTransitionError, but the event was applied`);
      return false;
    }
    state.byId.set(event.receiptId, next);
    return true;
  } catch (error) {
    if (!(event.rejected && error instanceof IllegalTransitionError))
      state.problems.push(`${label}: ${String(error)}`);
    return false;
  }
}

/** A `regrade` event (§8): the subject's receipt from a grading at the event's instant, or its deletion (§7). */
function regrade(
  state: EventState,
  event: Extract<BuiltEvent, { event: 'regrade' }>,
  pass: Pass,
  label: string,
) {
  const current = state.byId.get(event.receiptId);
  const next = pass.entries.find((entry) => entry.receipt.id === event.receiptId);
  if (current === undefined) return;
  if (next === undefined) {
    const pendingUnasked = current.state === 'PENDING' && current.grade === 'UNASKED';
    if (event.deleted && pendingUnasked) {
      state.byId.delete(event.receiptId);
      state.sources.delete(event.receiptId);
    } else state.problems.push(`${label}: the grading returns no receipt for this subject`);
    return;
  }
  if (event.deleted) {
    state.problems.push(`${label}: expected no receipt for this subject, got ${next.receipt.grade}`);
    return;
  }
  const applied = attempt(state, event, label, () =>
    transition(current, { event: 'regrade', next: next.receipt }),
  );
  if (applied) state.sources.set(event.receiptId, { evaluatedAt: event.evaluatedAt, inputs: next.inputs });
}

/** Applies the scenario's events in order (§8); each problem names the event and its subject. */
async function applyEvents(
  loaded: LoadedScenario,
  first: Pass,
  passAt: (evaluatedAt: IsoTs) => Promise<Pass>,
  names: Names,
): Promise<EventState> {
  const state: EventState = { byId: new Map(), sources: new Map(), problems: [] };
  for (const { receipt, inputs } of first.entries) {
    state.byId.set(receipt.id, receipt);
    state.sources.set(receipt.id, { evaluatedAt: first.evaluatedAt, inputs });
  }
  for (const [index, event] of loaded.events.entries()) {
    const label = `event ${String(index + 1)} (${event.event} ${names.subject(event.receiptId)})`;
    const receipt = state.byId.get(event.receiptId);
    if (receipt === undefined) {
      state.problems.push(`${label}: no receipt ${event.receiptId} to apply it to`);
      continue;
    }
    if (event.event === 'regrade') regrade(state, event, await passAt(event.evaluatedAt), label);
    else attempt(state, event, label, () => transition(receipt, event));
  }
  return state;
}

/** Runs one loaded scenario through the core, per the runner contract. */
export async function runScenario(loaded: LoadedScenario): Promise<ScenarioRun> {
  const policy = loadPolicy(loaded.policyJson);
  const call = loaded.gradeCall;
  const first: Pass =
    call === undefined
      ? await batchAt(loaded, policy, loaded.evaluatedAt)
      : {
          evaluatedAt: loaded.evaluatedAt,
          coverage: loaded.coverage,
          batch: false,
          entries: [runGrade(loaded, call, policy)],
        };
  const passes = new Map<string, Pass>([[first.evaluatedAt, first]]);
  const passAt = async (evaluatedAt: IsoTs): Promise<Pass> => {
    const held = passes.get(evaluatedAt) ?? (await batchAt(loaded, policy, evaluatedAt));
    passes.set(evaluatedAt, held);
    return held;
  };
  const names = namesOf(loaded);
  const state = await applyEvents(loaded, first, passAt, names);
  const problems = [...state.problems];
  for (const pass of passes.values())
    problems.push(...(await passProblems(loaded, policy, pass, names.subject)));
  return {
    policy,
    receipts: [...state.byId.values()],
    sources: state.sources,
    passes: [...passes.values()],
    problems,
  };
}
