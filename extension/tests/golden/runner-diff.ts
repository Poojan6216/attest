/**
 * Compares a scenario run (runner.ts) with the hand-computed expectations (tests/golden/README.md "Runner
 * contract"). `diffScenario` returns one line per disagreement, naming the subject by its ref (`c1`, `o2`,
 * `scope muse/gmail.read`) and the field, with the expected and the actual value; an empty list means the
 * scenario passes.
 */
import { features } from '../../src/core/features';
import { canonicalJson } from '../../src/core/hash';
import type { Policy } from '../../src/core/policy';
import { grantHash } from '../../src/core/receipt';
import { Receipt } from '../../src/core/schema';
import { BASIS_POINTS } from '../../src/core/units';
import type { LoadedScenario, ResolvedExpect } from './load';
import { fractionOf, type Names, namesOf, type ScenarioRun, type Source } from './runner';

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

/** What every comparison reads: the scenario, its run, the id → ref names, and the collected lines. */
interface Context {
  readonly loaded: LoadedScenario;
  readonly run: ScenarioRun;
  readonly names: Names;
  readonly diff: Diff;
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

/** The grading a receipt's current version came from (the scenario's own instant when none is recorded). */
function sourceOf(context: Context, receipt: Receipt): Source | undefined {
  return context.run.sources.get(receipt.id);
}

/** UNASKED (§7, Hard Rule 7): 'likely', the attributed agent, and the attribution score it was graded with. */
function diffUnasked(context: Context, s: string, entry: ResolvedExpect, receipt: Receipt): void {
  if (entry.expected.grade !== 'UNASKED') return;
  const attribution = sourceOf(context, receipt)?.inputs.context.attribution;
  const score =
    attribution === undefined
      ? null
      : fractionOf({ num: BigInt(attribution.scoreBp), den: BigInt(BASIS_POINTS) });
  context.diff.check(s, 'attribution', 'likely', receipt.attribution);
  context.diff.check(s, 'attributionScore', entry.expected.attributionScore, score);
  context.diff.check(s, 'attributed agent', receipt.agent, attribution?.agent);
}

/** The inputs the scenario states (§3 v1.4): the grant in force, priorSpendCents, the observed scope. */
function diffInputs(context: Context, s: string, entry: ResolvedExpect, receipt: Receipt): void {
  const stated = entry.inputs;
  if (stated === undefined) return;
  const inputs = sourceOf(context, receipt)?.inputs;
  if (stated.grant !== undefined) {
    const want = `${stated.grant.agent} grant of ${stated.grant.updatedAt}`;
    const got = inputs === undefined ? undefined : `${inputs.grant.agent} grant of ${inputs.grant.updatedAt}`;
    context.diff.check(s, 'inputs.grant', want, got);
    if (inputs !== undefined && grantHash(inputs.grant) !== grantHash(stated.grant))
      context.diff.lines.push(`${s} inputs.grant: not the stated grant (grantHash differs)`);
  }
  if (stated.priorSpendCents !== undefined)
    context.diff.check(s, 'inputs.priorSpendCents', stated.priorSpendCents, inputs?.context.priorSpendCents);
  if (stated.scope !== undefined)
    context.diff.check(s, 'inputs.scope', stated.scope, inputs?.context.scope?.observed);
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
  if (expected.finalFrom !== undefined) diff.check(s, 'finalFrom', expected.finalFrom, receipt.finalFrom);
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
  diffInputs(context, s, entry, receipt);
}

/**
 * Generic checks on every receipt (runner contract): schema, computedAt and finalAt (the instant of the grading
 * that produced it: the scenario's, or its last regrade's), finalFrom on every PENDING one (v1.18), the claim's agent; and the receipt's own subject (§3:
 * a claim receipt names its claim, a claim-less one none) and policy (§3 policyHash).
 */
function diffGeneric(context: Context, receipt: Receipt): void {
  const { diff, loaded } = context;
  const s = context.names.subject(receipt.id);
  const parsed = Receipt.safeParse(receipt);
  if (!parsed.success)
    diff.lines.push(`${s}: not a valid Receipt (${parsed.error.issues[0]?.message ?? ''})`);
  diff.check(s, 'claimId', context.names.claimId(receipt.id), receipt.claimId);
  diff.check(s, 'policyHash', context.run.policy.policyHash, receipt.policyHash);
  const at = sourceOf(context, receipt)?.evaluatedAt ?? loaded.evaluatedAt;
  diff.check(s, 'computedAt', at, receipt.computedAt);
  const before = receipt.state === 'USER_OVERRIDDEN' ? receipt.override?.previousState : receipt.state;
  diff.check(s, 'finalAt', before === 'FINAL' ? at : undefined, receipt.finalAt);
  diff.check(
    s,
    'finalFrom (present iff PENDING, v1.18)',
    before === 'PENDING',
    receipt.finalFrom !== undefined,
  );
  const claim = [...loaded.claims.values()].find((candidate) => candidate.id === receipt.claimId);
  if (claim !== undefined) diff.check(s, "agent (the claim's)", claim.agent, receipt.agent);
}

/**
 * The disagreements between a run and the scenario's expectations: missing and unexpected receipts, every
 * compared field, the generic checks, events that could not be applied as stated, and returned inputs that
 * disagree with the contract. Empty when the scenario passes.
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
