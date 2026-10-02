/**
 * §15 reason rules that need more than one expectation to check: the closed params per code (v1.3) and the
 * `allowlist.unchecked` emission rule (§6.1). Like checks.ts, every function returns the problems it found in
 * the scenario files themselves ([] = consistent with docs/grading.md); no core code runs here.
 */
import { type PolicyView } from './build';
import { subjectKind } from './checks';
import {
  ACTION_TYPES,
  AGENT_IDS,
  type ExpectedReceipt,
  OBSERVATION_SOURCES,
  type ParamKind,
  REASON_PARAMS,
  type ReasonCode,
  type Scenario,
  type ScenarioClaim,
  type ScenarioObservation,
} from './scenario-schema';

type Value = string | number;

const KIND_CHECKS: Readonly<Record<ParamKind, (value: Value) => boolean>> = {
  observationRef: (v) => typeof v === 'string' && /^o\d+$/.test(v),
  claimRef: (v) => typeof v === 'string' && /^c\d+$/.test(v),
  source: (v) => (OBSERVATION_SOURCES as readonly Value[]).includes(v),
  actionType: (v) => (ACTION_TYPES as readonly Value[]).includes(v),
  cents: (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
  currency: (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v),
  // Written as the observed scope; the loader stores sha256Hex(scope) (§15 v1.3).
  scopeHash: (v) => typeof v === 'string' && v.trim().length > 0,
  agent: (v) => (AGENT_IDS as readonly Value[]).includes(v),
  grade: (v) => v === 'VERIFIED' || v === 'NOT_FOUND',
};

const sameKeys = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((key) => b.includes(key));

/** One code's params: exactly the §15 names (a `source` may be left out), each of the right kind. */
function paramShapeProblems(code: ReasonCode, params: Readonly<Record<string, Value>>): string[] {
  const table = REASON_PARAMS[code];
  const names = Object.keys(params);
  const sourceOmitted = 'source' in table && names.length === 0;
  if (!sourceOmitted && !sameKeys(names, Object.keys(table)))
    return [`${code} params must be ${JSON.stringify(Object.keys(table))}`];
  return names.flatMap((name) => {
    const kind = table[name];
    const value = params[name];
    return kind !== undefined && value !== undefined && KIND_CHECKS[kind](value)
      ? []
      : [`${code}.${name} is not a ${String(kind)}`];
  });
}

const num = (value: Value | undefined): number => (typeof value === 'number' ? value : Number.NaN);

/** Params that must agree with the rest of the expectation (evidence, agent, override, supersede, ceiling). */
function paramAgreementProblems(
  e: ExpectedReceipt,
  p: NonNullable<ExpectedReceipt['reasonParams']>,
): string[] {
  const problems: string[] = [];
  const assigned = e.observationRefs[0];
  const best = p['match.best'];
  if (assigned !== undefined && best !== undefined && best.observationId !== assigned)
    problems.push('match.best must name the assigned candidate');
  for (const code of ['unasked.session', 'unasked.idle', 'unasked.signature', 'unasked.adjacent'] as const) {
    const signal = p[code];
    if (signal !== undefined && signal.agent !== e.agent)
      problems.push(`${code}.agent must be the receipt agent`);
  }
  const override = p['override.user'];
  if (override !== undefined && override.grade !== e.override)
    problems.push('override.user.grade must be the override grade');
  const superseded = p.superseded;
  if (superseded !== undefined && superseded.claimId !== e.supersededBy)
    problems.push('superseded.claimId must be supersededBy');
  const exceeded = p['ceiling.exceeded'];
  if (exceeded !== undefined && !(num(exceeded.amountCents) > num(exceeded.ceilingCents)))
    problems.push('ceiling.exceeded needs amountCents > ceilingCents');
  const cumulative = p['ceiling.cumulative_exceeded'];
  if (
    cumulative !== undefined &&
    !(num(cumulative.priorSpendCents) + num(cumulative.amountCents) > num(cumulative.ceilingCents))
  )
    problems.push('ceiling.cumulative_exceeded needs prior + amount > ceiling');
  const mismatch = p['ceiling.currency_mismatch'];
  if (mismatch !== undefined && mismatch.currency === mismatch.spendCurrency)
    problems.push('ceiling.currency_mismatch needs two different currencies');
  const scope = p['scope.observed_not_declared'];
  if (scope !== undefined && scope.scopeHash !== e.scope?.scope)
    problems.push('scope.observed_not_declared.scopeHash hashes the receipt scope, exactly as stored');
  return problems;
}

/** An expectation that asserts params names every reason code exactly once, each with the §15 params. */
export function reasonParamProblems(e: ExpectedReceipt): string[] {
  const p = e.reasonParams;
  if (p === undefined) return [];
  const label = e.ref ?? `scope:${e.scope?.scope ?? ''}`;
  const problems = sameKeys(Object.keys(p), e.reasonCodes) ? [] : ['reasonParams must key every reason code'];
  for (const code of e.reasonCodes) problems.push(...paramShapeProblems(code, p[code] ?? {}));
  problems.push(...paramAgreementProblems(e, p));
  return problems.map((problem) => `${label}: ${problem}`);
}

/**
 * §6.1 (v1.3) Amount: the larger of the claim's amount (counted only when the claim's currency is absent or
 * equals spendCurrency) and the assigned candidate's amount when that candidate is in spendCurrency. Undefined
 * when neither counts.
 */
function ceilingAmount(
  claim: ScenarioClaim,
  evidence: ScenarioObservation | undefined,
  spendCurrency: string | undefined,
): number | undefined {
  const claimCounts = claim.currency === undefined || claim.currency === spendCurrency;
  const fromClaim = claimCounts ? claim.amountCents : undefined;
  const fromEvidence = evidence?.currency === spendCurrency ? evidence?.amountCents : undefined;
  const known = [fromClaim, fromEvidence].flatMap((amount) => amount ?? []);
  return known.length === 0 ? undefined : Math.max(...known);
}

/** Params that must agree with the claim, its grant and the policy (source per type, ceiling, type, evidence). */
function claimParamProblems(scenario: Scenario, e: ExpectedReceipt, policy: PolicyView): string[] {
  const p = e.reasonParams ?? {};
  const claim = scenario.input.claims.find((c) => c.ref === e.ref);
  const grant = scenario.input.grants.find((g) => g.agent === claim?.agent);
  if (claim === undefined) return ['unknown claim'];
  const sources = policy.sourcesByType?.[claim.type] ?? [];
  const problems: string[] = [];
  for (const code of e.reasonCodes) {
    if (!('source' in REASON_PARAMS[code])) continue;
    const source = p[code]?.source;
    const ok = sources.length === 0 ? source === undefined : sources.includes(String(source));
    if (!ok) problems.push(`${code}.source must be a source of ${claim.type}, or absent if it has none`);
  }
  const typeParam = p['scope.type_not_allowed']?.type;
  if (typeParam !== undefined && typeParam !== claim.type) problems.push('scope.type_not_allowed.type');
  for (const code of ['ceiling.exceeded', 'ceiling.cumulative_exceeded'] as const) {
    const ceiling = p[code]?.ceilingCents;
    if (ceiling !== undefined && ceiling !== grant?.spendCeilingCents) problems.push(`${code}.ceilingCents`);
  }
  const cumulative = p['ceiling.cumulative_exceeded'];
  if (cumulative !== undefined && cumulative.amountCents !== claim.amountCents)
    problems.push('ceiling.cumulative_exceeded.amountCents is the claim amount');
  const evidence = scenario.input.observations.find((o) => o.ref === e.observationRefs[0]);
  const exceeded = p['ceiling.exceeded']?.amountCents;
  const amount = ceilingAmount(claim, evidence, grant?.spendCurrency);
  if (exceeded !== undefined && amount !== undefined && exceeded !== amount)
    problems.push(`ceiling.exceeded.amountCents is the §6.1 Amount, ${String(amount)}`);
  const mismatch = p['ceiling.currency_mismatch'];
  if (mismatch !== undefined) {
    if (mismatch.spendCurrency !== grant?.spendCurrency) problems.push('spendCurrency is the grant currency');
    if (mismatch.currency !== (claim.currency ?? evidence?.currency))
      problems.push('currency is the claim currency, else the assigned candidate currency');
  }
  return problems;
}

/** Scenario-level param checks for claim receipts that assert params. */
export function scenarioParamProblems(scenario: Scenario, policy: PolicyView): string[] {
  return scenario.expect
    .filter((e) => e.reasonParams !== undefined && subjectKind(e) === 'claim')
    .flatMap((e) => claimParamProblems(scenario, e, policy).map((problem) => `${e.ref ?? ''}: ${problem}`));
}

/**
 * §6.1 / §15 (v1.3): `allowlist.unchecked` appears iff the claim's type is an allowlist type, its grant has a
 * non-empty allowlist, the claim has no address of its own (a name, or no counterparty at all), nothing was
 * assigned to it, and the receipt is not OVER_SCOPE by another rule.
 */
export function allowlistUncheckedProblems(scenario: Scenario, policy: PolicyView): string[] {
  const problems: string[] = [];
  for (const e of scenario.expect.filter((x) => subjectKind(x) === 'claim')) {
    const claim = scenario.input.claims.find((c) => c.ref === e.ref);
    const grant = scenario.input.grants.find((g) => g.agent === claim?.agent);
    if (claim === undefined) continue;
    const listed = (policy.allowlistTypes ?? []).includes(claim.type);
    const allowlist = grant?.counterpartyAllowlist ?? [];
    const unchecked =
      listed &&
      allowlist.length > 0 &&
      claim.counterparty?.includes('@') !== true &&
      e.observationRefs.length === 0 &&
      e.grade !== 'OVER_SCOPE';
    if (unchecked !== e.reasonCodes.includes('allowlist.unchecked'))
      problems.push(`${claim.ref}: allowlist.unchecked must be ${String(unchecked)}`);
  }
  return problems;
}
