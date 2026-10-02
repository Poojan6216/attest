/**
 * The grant in force (docs/grading.md §3 v1.4), read from a scenario file: for an agent, the grant with the latest
 * `updatedAt ≤ evaluatedAt`. A scenario grant without `updatedAt` took effect one day before `evaluatedAt` (§15
 * loader default). The checks and proofs use it; the runner applies the same rule to the built grants.
 */
import { type Scenario, type ScenarioGrant } from './scenario-schema';
import { instantMs, MS_PER_DAY } from './time';

/** When the grant took effect, in epoch ms (the §15 default when the file does not say). */
export function grantUpdatedMs(grant: ScenarioGrant, evaluatedAt: string): number {
  return grant.updatedAt === undefined ? instantMs(evaluatedAt) - MS_PER_DAY : instantMs(grant.updatedAt);
}

/** The agent's grant in force at the scenario's `evaluatedAt`, or undefined when none has taken effect. */
export function grantInForce(scenario: Scenario, agent: string | undefined): ScenarioGrant | undefined {
  const { evaluatedAt, grants } = scenario.input;
  const limit = instantMs(evaluatedAt);
  let best: ScenarioGrant | undefined;
  for (const grant of grants) {
    const updated = grantUpdatedMs(grant, evaluatedAt);
    if (grant.agent !== agent || updated > limit) continue;
    if (best === undefined || updated > grantUpdatedMs(best, evaluatedAt)) best = grant;
  }
  return best;
}

/**
 * §3 v1.4 grant rules on the files: grant refs are unique; one agent's grants never share an `updatedAt` instant
 * (gradeBatch throws `ambiguous_grant`); every agent a claim or an expectation names has a grant in force (else
 * `missing_grant`); an expectation's `inputs.grant` is the grant in force of the receipt's agent.
 */
export function grantProblems(scenario: Scenario): string[] {
  const { grants, claims, evaluatedAt } = scenario.input;
  const problems: string[] = [];
  const refs = grants.flatMap((grant) => grant.ref ?? []);
  if (new Set(refs).size !== refs.length) problems.push('duplicate grant ref');
  const instants = grants.map((grant) => `${grant.agent} ${String(grantUpdatedMs(grant, evaluatedAt))}`);
  if (new Set(instants).size !== instants.length) problems.push('two grants of one agent at one instant');
  const agents = [...claims.map((c) => c.agent), ...scenario.expect.flatMap((e) => e.agent ?? [])];
  for (const agent of new Set(agents))
    if (grantInForce(scenario, agent) === undefined) problems.push(`no grant of ${agent} in force`);
  for (const e of scenario.expect) {
    const named = e.inputs?.grant;
    if (named === undefined) continue;
    const agent = e.agent ?? e.scope?.agent ?? claims.find((c) => c.ref === e.ref)?.agent;
    if (grantInForce(scenario, agent)?.ref !== named)
      problems.push(`${e.ref ?? 'scope'}: inputs.grant ${named} is not the grant in force`);
  }
  return problems;
}
