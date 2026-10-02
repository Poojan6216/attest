/**
 * The golden runner (tests/golden/README.md "Runner contract"; docs/grading.md §15). It calls the core exactly
 * as the contract says and compares every receipt with the hand-computed expectation:
 *
 *  - batch: `gradeBatch(batchClaims, createMemoryIndex(observations), grants, policy, coverage, activity, fixed)`;
 *  - grade: `grade(call.claim, call.candidates, grantOf(call.agent), policy, coverage, context)`, where context
 *    is the call's context plus, for a claim-less call with activity, `attribute(candidates[0], activity, …)`;
 *
 * then applies the scenario's events with `transition()` and diffs by receipt id. `diffScenario` returns one
 * line per disagreement, naming the subject by its ref (`c1`, `o2`, `scope muse/gmail.read`) and the field, with
 * the expected and the actual value; an empty list means the scenario passes.
 */
import { attribute } from '../../src/core/attribution';
import { gradeBatch } from '../../src/core/batch';
import { createMemoryIndex } from '../../src/core/candidates';
import { features } from '../../src/core/features';
import { grade } from '../../src/core/grade';
import { canonicalJson } from '../../src/core/hash';
import { loadPolicy, type Policy } from '../../src/core/policy';
import type { Ratio } from '../../src/core/ratio';
import { type Attribution, type Grant, type GradeContext, Receipt } from '../../src/core/schema';
import { type ReceiptEvent, transition } from '../../src/core/state';
import { BASIS_POINTS } from '../../src/core/units';
import { type BuiltGradeCall, type LoadedScenario, receiptIdFor, type ResolvedExpect } from './load';

/** The memory index's bucket width: an index tuning parameter (Decisions [1.3]), not policy. */
export const RUNNER_BUCKET_MINUTES = 15;

export interface ScenarioRun {
  readonly policy: Policy;
  /** The receipts after the scenario's events. */
  readonly receipts: readonly Receipt[];
  /** Events that could not be applied (no receipt with that id). */
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

function grantFor(grants: readonly Grant[], agent: string): Grant {
  const grant = grants.find((candidate) => candidate.agent === agent);
  if (grant === undefined) throw new Error(`golden runner: no grant for ${agent}`);
  return grant;
}

/** The attribution the grade-mode contract asks for, or none (§15: claim-less call with activity). */
function gradeModeAttribution(loaded: LoadedScenario, call: BuiltGradeCall, policy: Policy) {
  const orphan = call.candidates[0];
  if (!call.attributeFromActivity || orphan === undefined) return null;
  return attribute(orphan, loaded.activity, policy, loaded.evaluatedAt);
}

function runGrade(loaded: LoadedScenario, call: BuiltGradeCall, policy: Policy): Receipt {
  const attribution = gradeModeAttribution(loaded, call, policy);
  const context: GradeContext = attribution === null ? call.context : { ...call.context, attribution };
  const grant = grantFor(loaded.grants, call.agent);
  return grade(call.claim, call.candidates, grant, policy, loaded.coverage, context);
}

/** Applies the scenario's events in order (§8); an event whose receipt is missing is reported, not thrown. */
function applyEvents(loaded: LoadedScenario, graded: readonly Receipt[]) {
  const byId = new Map(graded.map((receipt) => [receipt.id, receipt]));
  const problems: string[] = [];
  for (const event of loaded.events) {
    const receipt = byId.get(event.receiptId);
    if (receipt === undefined) {
      problems.push(`event ${event.event}: no receipt ${event.receiptId} to apply it to`);
      continue;
    }
    // state.ts ignores the runner's extra `receiptId` property.
    const applied: ReceiptEvent = event;
    byId.set(event.receiptId, transition(receipt, applied));
  }
  return { receipts: [...byId.values()], problems };
}

/** Runs one loaded scenario through the core, per the runner contract. */
export async function runScenario(loaded: LoadedScenario): Promise<ScenarioRun> {
  const policy = loadPolicy(loaded.policyJson);
  const call = loaded.gradeCall;
  const graded =
    call === undefined
      ? await gradeBatch(
          loaded.batchClaims,
          createMemoryIndex([...loaded.observations.values()], RUNNER_BUCKET_MINUTES),
          loaded.grants,
          policy,
          loaded.coverage,
          loaded.activity,
          loaded.fixed,
        )
      : [runGrade(loaded, call, policy)];
  const { receipts, problems } = applyEvents(loaded, graded);
  return { policy, receipts, problems };
}

/** Ids → refs, so a diff names `c1` and `o2` instead of 26-character ids. */
interface Names {
  readonly ref: (id: string) => string;
  readonly subject: (receiptId: string) => string;
  /** §3: the claim a receipt id belongs to (`{k:'claim'}` subjects), else undefined (UNASKED, scope). */
  readonly claimId: (receiptId: string) => string | undefined;
}

function namesOf(loaded: LoadedScenario): Names {
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
    refs.set(observation.id, ref);
    subjects.set(receiptIdFor({ k: 'unasked', observationId: observation.id }), ref);
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

/** Collects `subject field: expected …, got …` lines; values compare as canonical JSON. */
class Diff {
  readonly lines: string[] = [];

  check(subject: string, field: string, expected: unknown, actual: unknown): void {
    if (canonicalJson(expected ?? null) !== canonicalJson(actual ?? null)) {
      const show = (value: unknown) => (value === undefined ? 'absent' : JSON.stringify(value));
      this.lines.push(`${subject} ${field}: expected ${show(expected)}, got ${show(actual)}`);
    }
  }
}

/** The exact score of the receipt's `match.best` candidate (§15), or null (`match.none`, no claim). */
function scoreOf(loaded: LoadedScenario, receipt: Receipt, policy: Policy): string | null {
  const best = receipt.reasons.find((reason) => reason.code === 'match.best');
  const claim = [...loaded.claims.values()].find((candidate) => candidate.id === receipt.claimId);
  if (best === undefined || claim === undefined) return null;
  const observation = [...loaded.observations.values()].find((o) => o.id === best.params.observationId);
  if (observation === undefined) return 'match.best names an observation not in the scenario';
  return fractionOf(features(claim, observation, policy).score);
}

/** The orphan's attribution, computed as gradeBatch and grade mode compute it (for `attributionScore`). */
function attributionOf(loaded: LoadedScenario, receipt: Receipt, policy: Policy): Attribution | null {
  const observation = [...loaded.observations.values()].find((o) => o.id === receipt.observationIds[0]);
  if (observation === undefined) return null;
  return attribute(observation, loaded.activity, policy, loaded.evaluatedAt);
}

/** What every comparison reads: the scenario, its run, the id → ref names, and the collected lines. */
interface Context {
  readonly loaded: LoadedScenario;
  readonly run: ScenarioRun;
  readonly names: Names;
  readonly diff: Diff;
}

/** UNASKED (§7, Hard Rule 7): 'likely', the attributed agent, and the attribution score in basis points. */
function diffUnasked(context: Context, s: string, entry: ResolvedExpect, receipt: Receipt): void {
  if (entry.expected.grade !== 'UNASKED') return;
  const attribution = attributionOf(context.loaded, receipt, context.run.policy);
  const score =
    attribution === null ? null : fractionOf({ num: BigInt(attribution.scoreBp), den: BigInt(BASIS_POINTS) });
  context.diff.check(s, 'attribution', 'likely', receipt.attribution);
  context.diff.check(s, 'attributionScore', entry.expected.attributionScore, score);
  context.diff.check(s, 'attributed agent', receipt.agent, attribution?.agent);
}

/** Every field the runner contract compares for one expected receipt. */
function diffExpected(context: Context, entry: ResolvedExpect): void {
  const { diff, names, run, loaded } = context;
  const s = names.subject(entry.receiptId);
  const receipt = run.receipts.find((candidate) => candidate.id === entry.receiptId);
  const { expected } = entry;
  if (receipt === undefined) {
    diff.lines.push(`${s}: expected a ${expected.grade} receipt (rule ${expected.ruleId}), got none`);
    return;
  }
  diff.check(s, 'grade', expected.grade, receipt.grade);
  diff.check(s, 'ruleId', expected.ruleId, receipt.ruleId);
  diff.check(s, 'state', expected.state, receipt.state);
  diff.check(s, 'observationIds', entry.observationIds.map(names.ref), receipt.observationIds.map(names.ref));
  diff.check(s, 'score', expected.score, scoreOf(loaded, receipt, run.policy));
  diff.check(
    s,
    'reasonCodes',
    expected.reasonCodes,
    receipt.reasons.map((reason) => reason.code),
  );
  if (entry.reasons !== undefined) diff.check(s, 'reasons', entry.reasons, receipt.reasons);
  if (expected.agent !== undefined) diff.check(s, 'agent', expected.agent, receipt.agent);
  diff.check(s, 'override.grade', expected.override, receipt.override?.grade);
  diff.check(s, 'override.previousState', expected.previousState, receipt.override?.previousState);
  diff.check(s, 'supersededBy', entry.supersededById, receipt.supersededBy);
  diffUnasked(context, s, entry, receipt);
}

/**
 * Generic checks on every receipt (runner contract): schema, computedAt, finalAt, the claim's agent; and the
 * receipt's own subject (§3: a claim receipt names its claim, a claim-less one none) and policy (§3 policyHash).
 */
function diffGeneric(context: Context, receipt: Receipt): void {
  const { diff, loaded } = context;
  const s = context.names.subject(receipt.id);
  const parsed = Receipt.safeParse(receipt);
  if (!parsed.success)
    diff.lines.push(`${s}: not a valid Receipt (${parsed.error.issues[0]?.message ?? ''})`);
  diff.check(s, 'claimId', context.names.claimId(receipt.id), receipt.claimId);
  diff.check(s, 'policyHash', context.run.policy.policyHash, receipt.policyHash);
  diff.check(s, 'computedAt', loaded.evaluatedAt, receipt.computedAt);
  const before = receipt.state === 'USER_OVERRIDDEN' ? receipt.override?.previousState : receipt.state;
  diff.check(s, 'finalAt', before === 'FINAL' ? loaded.evaluatedAt : undefined, receipt.finalAt);
  const claim = [...loaded.claims.values()].find((candidate) => candidate.id === receipt.claimId);
  if (claim !== undefined) diff.check(s, "agent (the claim's)", claim.agent, receipt.agent);
}

/**
 * The disagreements between a run and the scenario's expectations: missing and unexpected receipts, every
 * compared field, the generic checks, and events that could not be applied. Empty when the scenario passes.
 */
export function diffScenario(loaded: LoadedScenario, run: ScenarioRun): string[] {
  const context: Context = { loaded, run, names: namesOf(loaded), diff: new Diff() };
  context.diff.lines.push(...run.problems);
  for (const entry of loaded.expected) diffExpected(context, entry);
  const expectedIds = new Set(loaded.expected.map((entry) => entry.receiptId));
  for (const receipt of run.receipts) {
    if (!expectedIds.has(receipt.id)) {
      const s = context.names.subject(receipt.id);
      context.diff.lines.push(
        `${s}: unexpected ${receipt.grade} receipt (rule ${receipt.ruleId}, ${receipt.state})`,
      );
    }
    diffGeneric(context, receipt);
  }
  return context.diff.lines;
}
