/**
 * Contract invariants every golden scenario must satisfy, checked on the scenario files themselves (no core
 * code runs here). Each function returns a list of problems; [] means the file is consistent with
 * docs/grading.md §2, §4.3, §6, §8 and the §15 emission table. scenarios.spec.ts asserts [] for every file
 * and mutation tests prove each check bites.
 */
import { loadPolicy, type PolicyBasisPoints, type SignalName } from '../../src/core/policy';
import { BASIS_POINTS } from '../../src/core/units';
import { type PolicyView } from './load';
import { grantInForce, grantProblems } from './grants';
import {
  type ExpectedReceipt,
  parseFraction,
  REASON_CODES,
  type ReasonCode,
  type Scenario,
  type ScenarioObservation,
} from './scenario-schema';
import { instantMs } from './time';

const BP_CACHE = new WeakMap<PolicyView, PolicyBasisPoints>();

/** The policy's thresholds as the core loads them (§5.3: integer basis points; never the decimal fields). */
export function basisPointsOf(policy: PolicyView): PolicyBasisPoints {
  const cached = BP_CACHE.get(policy);
  if (cached !== undefined) return cached;
  const { bp } = loadPolicy(policy);
  BP_CACHE.set(policy, bp);
  return bp;
}

/** fraction "p/q" ≥ bp/10000, compared exactly. */
export function atLeast(score: string, bp: number): boolean {
  const { num, den } = parseFraction(score);
  return BigInt(BASIS_POINTS) * num >= BigInt(bp) * den;
}

/**
 * §15 (v1.3) order groups: the rule's own code first, then `allowlist.unchecked` if emitted, then coverage
 * reasons, then match and counterparty reasons, then `override.user` and `superseded`; each group in table
 * order. The rule's own codes are the rule codes of the table (claim.*, coverage.none/partial, grace.waiting,
 * scope.*, ceiling.*), `coverage.never_completed` (the `pending` rule's own code once it finalises by time,
 * v1.3) and, on UNASKED receipts, the fired unasked.* signals.
 */
const COVERAGE_GROUP: readonly ReasonCode[] = [
  'coverage.account_unbound',
  'coverage.calendars_hidden',
  'coverage.changes_unfollowed',
  'coverage.change_unprovable',
  'coverage.clock_repaired',
  'coverage.list_unsettled',
  'coverage.account_partial',
  'coverage.multiple_accounts',
  'coverage.no_account',
  'coverage.no_parser',
];
const COVERAGE_CAPS = COVERAGE_GROUP.slice(1);
const EVENT_GROUP: readonly ReasonCode[] = ['override.user', 'superseded'];

export function groupOf(code: ReasonCode): number {
  if (EVENT_GROUP.includes(code)) return 4;
  if (code.startsWith('match.') || code.startsWith('cp.')) return 3;
  if (COVERAGE_GROUP.includes(code)) return 2;
  if (code === 'allowlist.unchecked') return 1;
  return 0;
}

/** Codes are grouped in order and, within a group, in table order without repeats. */
export function reasonOrderProblems(codes: readonly ReasonCode[]): string[] {
  const problems: string[] = [];
  for (let i = 1; i < codes.length; i += 1) {
    const [prev, next] = [codes[i - 1], codes[i]];
    if (prev === undefined || next === undefined) continue;
    const order = groupOf(prev) - groupOf(next) || REASON_CODES.indexOf(prev) - REASON_CODES.indexOf(next);
    if (order >= 0) problems.push(`reason ${next} must not follow ${prev}`);
  }
  return problems;
}

/** The rule reason each rule emits (§15 table); [] for rules that add no rule code. */
const RULE_REASONS: Readonly<Record<string, readonly (readonly ReasonCode[])[]>> = {
  over_scope: [['scope.type_not_allowed']],
  over_allowlist: [['scope.counterparty_not_allowed']],
  // §6.1 v1.3: currency_mismatch replaces exceeded unless the §6.1 Amount also exceeds the ceiling.
  over_ceiling: [
    ['ceiling.exceeded'],
    ['ceiling.currency_mismatch'],
    ['ceiling.exceeded', 'ceiling.currency_mismatch'],
  ],
  over_ceiling_cumulative: [['ceiling.cumulative_exceeded']],
  over_scope_observed: [['scope.observed_not_declared']],
  no_target: [['claim.no_target']],
  underspecified: [['claim.too_vague']],
  no_coverage: [['coverage.none']],
  partial_coverage: [['coverage.partial']],
};
const RULE_CODE_SET = new Set(Object.values(RULE_REASONS).flat(2));
RULE_CODE_SET.add('grace.waiting');
RULE_CODE_SET.add('coverage.never_completed');

export type SubjectKind = 'claim' | 'unasked' | 'scope';

export function subjectKind(e: ExpectedReceipt): SubjectKind {
  if (e.scope !== undefined) return 'scope';
  return e.ref?.startsWith('c') === true ? 'claim' : 'unasked';
}

/** The rule code(s) the receipt must carry, given its rule and state. */
function ruleCodeProblems(e: ExpectedReceipt): string[] {
  const own = e.reasonCodes.filter((code) => RULE_CODE_SET.has(code));
  let allowed: readonly (readonly ReasonCode[])[] = RULE_REASONS[e.ruleId] ?? [[]];
  // An override keeps the graded reasons, so the pending rule's code follows the state before the override.
  if (e.ruleId === 'pending')
    allowed = [[(e.previousState ?? e.state) === 'PENDING' ? 'grace.waiting' : 'coverage.never_completed']];
  const ok = allowed.some((codes) => codes.length === own.length && codes.every((c, i) => own[i] === c));
  const unasked = e.reasonCodes.filter((code) => code.startsWith('unasked.'));
  const problems = ok ? [] : [`rule ${e.ruleId} (${e.state}) needs rule reason ${JSON.stringify(allowed)}`];
  if ((e.ruleId === 'unasked') !== unasked.length > 0) problems.push('unasked.* ⇔ rule unasked');
  return problems;
}

function gradeOfRule(ruleId: string, policy: PolicyView): string | undefined {
  if (ruleId === 'default_unverifiable') return 'UNVERIFIABLE';
  const then = policy.rules.find((rule) => rule.id === ruleId)?.then;
  return then === 'PENDING' ? 'UNVERIFIABLE' : then;
}

/**
 * §6 first match wins: a receipt graded by a rule that comes after `verified` (or `partial`) in policy order,
 * or by the terminal default, cannot have a best score that rule would have matched first.
 */
function ruleOrderScoreProblems(e: ExpectedReceipt, policy: PolicyView): string[] {
  // The rules read the raised score when the model raised one (§5.4), the floor otherwise.
  const ruled = e.raisedScore ?? e.score;
  if (ruled === null) return [];
  const ids = policy.rules.map((rule) => rule.id);
  const position = (id: string): number => (ids.includes(id) ? ids.indexOf(id) : ids.length);
  const { thresholds } = basisPointsOf(policy);
  const problems: string[] = [];
  for (const rule of ['verified', 'partial'] as const) {
    if (ids.includes(rule) && position(e.ruleId) > position(rule) && atLeast(ruled, thresholds[rule]))
      problems.push(`rule ${e.ruleId} comes after ${rule}, so its best score must be below ${rule}`);
  }
  return problems;
}

/** Score, evidence and match reasons agree with the thresholds and the one-to-one assignment (§4.3, §5.3). */
function scoreProblems(e: ExpectedReceipt, policy: PolicyView): string[] {
  const { verified, partial } = basisPointsOf(policy).thresholds;
  const problems: string[] = [...ruleOrderScoreProblems(e, policy)];
  const has = (code: ReasonCode): boolean => e.reasonCodes.includes(code);
  const assigned = e.score !== null && atLeast(e.score, partial);
  if (has('match.best') === has('match.none')) problems.push('exactly one of match.best / match.none');
  if (has('match.best') !== (e.score !== null)) problems.push('match.best ⇔ a scored best candidate');
  if (e.reasonCodes.some((c) => c.startsWith('cp.')) && !has('match.best'))
    problems.push('cp.* needs match.best');
  if (e.observationRefs.length !== (assigned ? 1 : 0))
    problems.push('evidence = the assigned candidate only');
  // The rules read the raised score (§5.4); assignment and evidence follow the floor alone.
  const ruled = e.raisedScore ?? e.score;
  if (e.ruleId === 'verified' && !(ruled !== null && atLeast(ruled, verified))) problems.push('verified < T');
  if (e.ruleId === 'partial' && !(assigned && ruled !== null && !atLeast(ruled, verified))) {
    problems.push('partial outside [partial, verified)');
  }
  if (e.grade === 'NOT_FOUND' && assigned) problems.push('NOT_FOUND with a score ≥ partial');
  return problems;
}

/** The §7 signal behind each unasked.* reason, by its policy weight key. */
const SIGNAL_OF: Readonly<Partial<Record<ReasonCode, SignalName>>> = {
  'unasked.session': 'agentSessionActive',
  'unasked.idle': 'userIdle',
  'unasked.signature': 'agentSignature',
  'unasked.adjacent': 'activityLogAdjacent',
};

/** Every code a claim-less receipt may carry (§15 Emission): no match, cp, coverage or allowlist code. */
const CLAIMLESS_CODES: Readonly<Record<'unasked' | 'scope', readonly ReasonCode[]>> = {
  unasked: [
    'unasked.session',
    'unasked.idle',
    'unasked.signature',
    'unasked.adjacent',
    'override.user',
    'superseded',
  ],
  scope: ['scope.observed_not_declared', 'override.user'],
};

/** fraction "p/q" = bp/10000, compared exactly. */
function equalsBasisPoints(score: string, bp: number): boolean {
  const { num, den } = parseFraction(score);
  return BigInt(BASIS_POINTS) * num === BigInt(bp) * den;
}

/**
 * §7: the reasons are the attributed agent's fired signals (at least one agent-specific: userIdle alone never
 * attributes) plus userIdle, and the score is their weights' sum capped at 1, exact in basis points.
 */
function attributionProblems(e: ExpectedReceipt, bp: PolicyBasisPoints['unasked']): string[] {
  const signals = e.reasonCodes.flatMap((code) => SIGNAL_OF[code] ?? []);
  const problems: string[] = [];
  if (!signals.some((signal) => signal !== 'userIdle'))
    problems.push('UNASKED needs an agent-specific signal');
  const sum = Math.min(
    BASIS_POINTS,
    signals.reduce((total, signal) => total + bp.signals[signal], 0),
  );
  if (e.attributionScore === undefined || !equalsBasisPoints(e.attributionScore, sum))
    problems.push(`attributionScore must be the fired signals' weights, ${String(sum)} bp`);
  if (!atLeast(e.attributionScore ?? '0/1', bp.threshold))
    problems.push('UNASKED needs an attribution score ≥ unasked.threshold');
  return problems;
}

function claimlessProblems(e: ExpectedReceipt, kind: 'unasked' | 'scope', policy: PolicyView): string[] {
  const problems: string[] = [];
  if (e.score !== null) problems.push('claim-less receipts are never scored');
  const foreign = e.reasonCodes.filter((code) => !CLAIMLESS_CODES[kind].includes(code));
  if (foreign.length > 0) problems.push(`no ${foreign.join(', ')} on a claim-less receipt`);
  if (e.agent === undefined) problems.push('claim-less receipts name their agent');
  // §8 v1.4: a claim-less grade() that matches no UNASKED/OVER_SCOPE rule is default_unverifiable, FINAL, no evidence.
  if (e.ruleId === 'default_unverifiable') {
    if (e.state === 'PENDING' || e.observationRefs.length > 0)
      problems.push('claim-less default: FINAL, no evidence');
    return problems;
  }
  if (kind === 'scope') {
    if (e.ruleId !== 'over_scope_observed' || e.observationRefs.length > 0)
      problems.push('scope receipt shape');
    return problems;
  }
  if (e.grade !== 'UNASKED' || e.ruleId !== 'unasked')
    problems.push('only UNASKED orphans are kept (§1, §7)');
  problems.push(...attributionProblems(e, basisPointsOf(policy).unasked));
  if (e.observationRefs.length !== 1 || e.observationRefs[0] !== e.ref)
    problems.push('UNASKED names its orphan');
  return problems;
}

/** Codes that only appear with one rule, grade or state (§15 Emission). */
function emissionProblems(e: ExpectedReceipt): string[] {
  const problems: string[] = [];
  const has = (code: ReasonCode): boolean => e.reasonCodes.includes(code);
  if (COVERAGE_CAPS.some(has) && e.ruleId !== 'partial_coverage')
    problems.push('caps only on partial_coverage');
  if (has('coverage.account_unbound') && e.grade !== 'NOT_FOUND')
    problems.push('account_unbound only on NOT_FOUND');
  if (has('allowlist.unchecked') && e.grade === 'OVER_SCOPE')
    problems.push('allowlist.unchecked on OVER_SCOPE');
  if (has('override.user') !== (e.state === 'USER_OVERRIDDEN'))
    problems.push('override.user ⇔ USER_OVERRIDDEN');
  if ((e.override === undefined) !== (e.state !== 'USER_OVERRIDDEN'))
    problems.push('override ⇔ USER_OVERRIDDEN');
  if ((e.override === undefined) !== (e.previousState === undefined))
    problems.push('override needs previousState');
  if (has('superseded') !== (e.supersededBy !== undefined)) problems.push('superseded ⇔ supersededBy');
  if (e.supersededBy !== undefined && e.grade !== 'UNASKED') problems.push('only UNASKED is superseded');
  if ((e.attributionScore !== undefined) !== (e.grade === 'UNASKED'))
    problems.push('attributionScore ⇔ UNASKED');
  return problems;
}

export function expectationProblems(e: ExpectedReceipt, policy: PolicyView): string[] {
  const kind = subjectKind(e);
  const problems = [...reasonOrderProblems(e.reasonCodes), ...ruleCodeProblems(e), ...emissionProblems(e)];
  if (gradeOfRule(e.ruleId, policy) !== e.grade) problems.push(`rule ${e.ruleId} does not give ${e.grade}`);
  if (kind === 'claim') problems.push(...scoreProblems(e, policy));
  else problems.push(...claimlessProblems(e, kind, policy));
  const label = e.ref ?? `scope:${e.scope?.scope ?? ''}`;
  return problems.map((problem) => `${label}: ${problem}`);
}

/** NOT_FOUND carries coverage.account_unbound iff the grant binds no account for a relevant source (§6.1). */
export function accountBindingProblems(scenario: Scenario, policy: PolicyView): string[] {
  const problems: string[] = [];
  for (const e of scenario.expect) {
    if (e.grade !== 'NOT_FOUND') continue;
    const claim = scenario.input.claims.find((c) => c.ref === e.ref);
    const grant = grantInForce(scenario, claim?.agent);
    const sources = claim === undefined ? [] : (policy.sourcesByType?.[claim.type] ?? []);
    const unbound = sources.some(
      (source) => grant?.accounts?.[source as ScenarioObservation['source']] === undefined,
    );
    if (unbound !== e.reasonCodes.includes('coverage.account_unbound')) {
      problems.push(`${e.ref ?? ''}: coverage.account_unbound must be ${String(unbound)}`);
    }
  }
  return problems;
}

/** Fields an observation may carry besides its allowlisted content (§10, §12 allowlistedFields). */
const STRUCTURAL = new Set(['ref', 'source', 'type', 'observedAt', 'rowKey']);

export function inputProblems(scenario: Scenario, policy: PolicyView): string[] {
  const problems: string[] = [];
  for (const o of scenario.input.observations) {
    const allowlisted = policy.allowlistedFields[o.source] ?? [];
    for (const key of Object.keys(o)) {
      if (!STRUCTURAL.has(key) && !allowlisted.includes(key))
        problems.push(`${o.ref}: ${key} not allowlisted`);
    }
    if (!(policy.sourcesByType?.[o.type] ?? []).includes(o.source)) {
      problems.push(`${o.ref}: ${o.source} does not observe ${o.type}`);
    }
  }
  for (const g of scenario.input.grants) {
    const hasCeiling = g.spendCeilingCents !== undefined && g.spendCeilingCents !== null;
    if (hasCeiling && g.spendCurrency === undefined)
      problems.push(`${g.agent}: ceiling without spendCurrency`);
  }
  return problems;
}

function refsUsed(scenario: Scenario): string[] {
  const { fixed = [], activity, grade } = scenario.input;
  const optional = (ref: string | null | undefined): string[] =>
    ref === undefined || ref === null ? [] : [ref];
  return [
    ...scenario.expect.flatMap((e) => [
      ...optional(e.ref),
      ...e.observationRefs,
      ...optional(e.supersededBy),
    ]),
    ...fixed.flatMap((pair) => [pair.observation, ...optional(pair.claim)]),
    ...(activity?.claims ?? []),
    ...(grade === undefined ? [] : [...grade.candidates, ...optional(grade.claim)]),
    ...(scenario.events ?? []).flatMap((ev) => [ev.ref, ...(ev.event === 'supersede' ? [ev.claim] : [])]),
    ...(scenario.assertIds?.equal ?? []).flat(),
    ...(scenario.assertIds?.ascending ?? []).flat(),
  ];
}

const subjectKey = (e: ExpectedReceipt): string =>
  e.scope === undefined ? (e.ref ?? '') : `scope:${e.scope.agent}:${e.scope.scope}`;

/** Batch: one receipt per graded claim, none for fixed claims, and evidence is one-to-one (§4.3). */
function batchSubjectProblems(scenario: Scenario): string[] {
  const problems: string[] = [];
  const fixed = scenario.input.fixed ?? [];
  const fixedClaims = new Set(fixed.flatMap((pair) => (pair.claim === null ? [] : [pair.claim])));
  const subjects = scenario.expect.map(subjectKey);
  const evaluatedMs = instantMs(scenario.input.evaluatedAt);
  for (const claim of scenario.input.claims) {
    const count = subjects.filter((key) => key === claim.ref).length;
    // §3 v1.4: a claim first seen after evaluatedAt is ignored (no receipt).
    const later = instantMs(claim.observedAt ?? claim.claimedAt) > evaluatedMs;
    const want = fixedClaims.has(claim.ref) || later ? 0 : 1;
    if (count !== want) problems.push(`${claim.ref}: ${String(count)} expectations, want ${String(want)}`);
  }
  for (const e of scenario.expect) {
    if (subjectKind(e) !== 'claim' && e.grade !== 'UNASKED' && e.grade !== 'OVER_SCOPE')
      problems.push(
        `${e.ref ?? 'scope'}: gradeBatch returns claim-less receipts only when UNASKED or OVER_SCOPE`,
      );
  }
  const taken = [
    ...fixed.map((pair) => pair.observation),
    ...scenario.expect.filter((e) => subjectKind(e) === 'claim').flatMap((e) => e.observationRefs),
    ...scenario.expect.filter((e) => subjectKind(e) === 'unasked').map((e) => e.ref ?? ''),
  ];
  if (new Set(taken).size !== taken.length) problems.push('an observation is evidence or orphan twice');
  return problems;
}

function gradeSubjectProblems(scenario: Scenario): string[] {
  const call = scenario.input.grade;
  if (call === undefined) return ['mode grade needs input.grade'];
  const [only, ...rest] = scenario.expect;
  const subject =
    call.scope !== undefined ? `scope:${call.agent ?? ''}:${call.scope}` : (call.claim ?? call.candidates[0]);
  if (only === undefined || rest.length > 0) return ['mode grade expects exactly one receipt'];
  return subjectKey(only) === subject ? [] : [`grade subject is ${String(subject)}`];
}

export function refProblems(scenario: Scenario): string[] {
  const { claims, observations } = scenario.input;
  const claimRefs = new Set(claims.map((c) => c.ref));
  const obsRefs = new Set(observations.map((o) => o.ref));
  const problems: string[] = [];
  if (claimRefs.size !== claims.length || obsRefs.size !== observations.length)
    problems.push('duplicate ref');
  for (const ref of refsUsed(scenario)) {
    if (!(ref.startsWith('c') ? claimRefs : obsRefs).has(ref)) problems.push(`unknown ref ${ref}`);
  }
  const subjects = scenario.expect.map(subjectKey);
  if (new Set(subjects).size !== subjects.length) problems.push('two expectations for one subject');
  const deleted = (scenario.events ?? []).flatMap((ev) =>
    ev.event === 'regrade' && ev.deleted ? [ev.ref] : [],
  );
  for (const ev of scenario.events ?? [])
    if (!subjects.includes(ev.ref) && !deleted.includes(ev.ref)) problems.push(`event on ${ev.ref}`);
  problems.push(...grantProblems(scenario));
  problems.push(
    ...(scenario.mode === 'batch' ? batchSubjectProblems(scenario) : gradeSubjectProblems(scenario)),
  );
  return problems;
}
