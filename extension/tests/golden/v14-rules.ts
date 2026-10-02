/**
 * The contract v1.4 rules the golden suite must prove (docs/grading.md v1.4/v1.5; Decisions [1.contract] v1.4).
 * Each entry is a `contract:<tag>` that some scenario must carry, and a predicate that the tagged scenario really
 * exercises the rule; every proof is false on a plain exact match, and v14-rules.spec.ts shows each one fails on a
 * broken copy of its own file. This file holds attribution, coverage, grants, inputs and claim-less subjects;
 * v14-rules-events.ts the event rules and the params corrections.
 */
import { type PolicyView } from './build';
import { grantInForce, grantUpdatedMs } from './grants';
import { claimOf, minutes, minuteWindow, type Proof } from './proof-helpers';
import {
  type ExpectedReceipt,
  type Scenario,
  type ScenarioClaim,
  type ScenarioObservation,
} from './scenario-schema';
import { instantMs } from './time';
import { EVENT_RULES } from './v14-rules-events';

const observationOf = (s: Scenario, ref: string | undefined): ScenarioObservation | undefined =>
  s.input.observations.find((o) => o.ref === ref);

/** §7: a minute claim's unit [start, end] lies within ±adjacentMin of the anchor. */
function unitNear(claim: ScenarioClaim, anchorMs: number, policy: PolicyView): boolean {
  const { start, end } = minuteWindow(claim, policy);
  const reach = minutes(policy.unasked.windows.adjacentMin);
  return start - reach <= anchorMs && anchorMs <= end + reach;
}

const unaskedWith = (s: Scenario, code: string): ExpectedReceipt[] =>
  s.expect.filter((e) => e.grade === 'UNASKED' && e.reasonCodes.some((c) => c === code));

/** §7 v1.4: an underspecified claim of the agent next to the orphan does not stop unasked.adjacent. */
const vagueClaimNoSuppression: Proof = (s, policy) =>
  unaskedWith(s, 'unasked.adjacent').some((e) => {
    const orphan = observationOf(s, e.ref);
    if (orphan === undefined) return false;
    return s.expect.some((other) => {
      const claim = claimOf(s, other);
      return (
        other.ruleId === 'underspecified' &&
        claim !== undefined &&
        claim.agent === e.agent &&
        claim.type === orphan.type &&
        unitNear(claim, instantMs(orphan.occurredAt), policy)
      );
    });
  });

/** The agent's session pings within ±sessionMin of `atMs`. */
function sessionNear(s: Scenario, agent: string | undefined, atMs: number, policy: PolicyView): boolean {
  const reach = minutes(policy.unasked.windows.sessionMin);
  return (s.input.activity?.sessions ?? []).some(
    (p) => p.agent === agent && Math.abs(instantMs(p.at) - atMs) <= reach,
  );
}

/** The sightings of an observation: itself and every observation `assertIds.equal` ties to it. */
function sightings(s: Scenario, ref: string): ScenarioObservation[] {
  const refs = new Set([ref]);
  for (const [a, b] of s.assertIds?.equal ?? [])
    if (a === ref || b === ref) [a, b].forEach((r) => refs.add(r));
  return s.input.observations.filter((o) => refs.has(o.ref));
}

/**
 * §7 v1.4: a calendar orphan is UNASKED from a session near its FIRST sighting, none near its start or its later
 * sighting; and another calendar event with a session near its start (but not its sighting) has no receipt.
 */
const calendarAnchorFirstSeen: Proof = (s, policy) => {
  const seenMs = (o: ScenarioObservation): number => instantMs(o.observedAt ?? s.input.evaluatedAt);
  const attributed = s.expect.some((e) => {
    const all = sightings(s, e.ref ?? '').filter((o) => o.type.startsWith('calendar.'));
    const [one] = all;
    if (e.grade !== 'UNASKED' || one === undefined || all.length < 2) return false;
    const times = all.map(seenMs);
    const first = Math.min(...times);
    const last = Math.max(...times);
    const start = instantMs(one.occurredAt);
    return (
      sessionNear(s, e.agent, first, policy) &&
      !sessionNear(s, e.agent, last, policy) &&
      !sessionNear(s, e.agent, start, policy)
    );
  });
  const unattributed = s.input.observations.some(
    (o) =>
      o.type.startsWith('calendar.') &&
      !s.expect.some((e) => e.ref === o.ref) &&
      (s.input.activity?.sessions ?? []).some((p) =>
        sessionNear(s, p.agent, instantMs(o.occurredAt), policy),
      ) &&
      !(s.input.activity?.sessions ?? []).some((p) => sessionNear(s, p.agent, seenMs(o), policy)),
  );
  return attributed && unattributed;
};

/** §6.1 v1.4: one source holds the window, another does not overlap it, their union does, and no NOT_FOUND. */
const perSourceCoverage: Proof = (s, policy) =>
  s.expect.some((e) => {
    const claim = claimOf(s, e);
    const sources = claim === undefined ? [] : (policy.sourcesByType?.[claim.type] ?? []);
    if (claim === undefined || sources.length < 2 || e.grade === 'NOT_FOUND') return false;
    const { from, to } = minuteWindow(claim, policy);
    const entries = (source: string) => s.input.coverage.filter((c) => c.source === source);
    const holds = (source: string): boolean =>
      entries(source).some((c) => instantMs(c.windowStart) <= from && to <= instantMs(c.windowEnd));
    const misses = (source: string): boolean =>
      entries(source).every((c) => instantMs(c.windowEnd) < from || to < instantMs(c.windowStart));
    return sources.some(holds) && sources.some(misses); // a source that holds the window cannot miss it
  });

/** §3 v1.4: a scope-diff receipt states the grant in force and the observed scope it was graded with. */
const scopeReceiptInputs: Proof = (s) =>
  s.expect.some(
    (e) =>
      e.scope !== undefined &&
      e.inputs?.scope === e.scope.scope &&
      e.inputs.grant !== undefined &&
      grantInForce(s, e.scope.agent)?.ref === e.inputs.grant,
  );

/** §3 v1.4: a claim first seen after evaluatedAt gets no receipt, adds no spend and suppresses no adjacency. */
const claimAfterEvaluatedIgnored: Proof = (s, policy) => {
  const evaluated = instantMs(s.input.evaluatedAt);
  const late = s.input.claims.filter(
    (c) =>
      c.observedAt !== undefined &&
      instantMs(c.observedAt) > evaluated &&
      !s.expect.some((e) => e.ref === c.ref),
  );
  const spend = s.expect.some((e) => {
    const claim = claimOf(s, e);
    return (
      e.inputs?.priorSpendCents === 0 &&
      late.some(
        (c) =>
          c.agent === claim?.agent &&
          c.type === claim.type &&
          c.currency === claim.currency &&
          (c.amountCents ?? 0) > 0 &&
          instantMs(c.claimedAt) < instantMs(claim.claimedAt),
      )
    );
  });
  const adjacency = unaskedWith(s, 'unasked.adjacent').some((e) => {
    const orphan = observationOf(s, e.ref);
    return late.some(
      (c) =>
        c.agent === e.agent &&
        c.type === orphan?.type &&
        c.counterparty?.includes('@') === true &&
        unitNear(c, instantMs(orphan.occurredAt), policy),
    );
  });
  return spend && adjacency;
};

/**
 * §3 v1.4: of several grants of one agent, the receipts name the latest not after evaluatedAt, which is neither
 * the first nor the last in the file, nor the first or last of those already in force, nor the latest overall (one
 * took effect after evaluatedAt); and it took effect at evaluatedAt itself, so `≤` (not `<`) is what keeps it.
 */
const grantLatestUpdatedAt: Proof = (s) =>
  s.expect.some((e) => {
    const agent = e.agent ?? e.scope?.agent ?? claimOf(s, e)?.agent;
    const own = s.input.grants.filter((g) => g.agent === agent);
    const chosen = grantInForce(s, agent);
    const evaluated = instantMs(s.input.evaluatedAt);
    const updated = (g: (typeof own)[number]): number => grantUpdatedMs(g, s.input.evaluatedAt);
    const inForce = own.filter((g) => updated(g) <= evaluated);
    return (
      own.some((g) => updated(g) > evaluated) &&
      chosen !== undefined &&
      e.inputs?.grant === chosen.ref &&
      updated(chosen) === evaluated &&
      ![own[0], own.at(-1), inForce[0], inForce.at(-1)].includes(chosen)
    );
  });

/** §8 v1.4: grade() on an orphan below the threshold → default_unverifiable, FINAL, the orphan's subject, no evidence. */
const claimlessDefaultOrphan: Proof = (s) =>
  s.mode === 'grade' &&
  s.input.grade?.claim === null &&
  s.input.activity !== undefined &&
  s.expect.some(
    (e) =>
      e.ref === s.input.grade?.candidates[0] &&
      e.ruleId === 'default_unverifiable' &&
      e.state === 'FINAL' &&
      e.observationRefs.length === 0,
  );

/** §8 v1.4: grade() on a declared scope → default_unverifiable, FINAL, the scope's subject. */
const claimlessDefaultScope: Proof = (s) => {
  const call = s.input.grade;
  const declared = s.input.grants.some(
    (g) => g.agent === call?.agent && (g.declaredScopes ?? []).includes(call.scope ?? ''),
  );
  return (
    s.mode === 'grade' &&
    declared &&
    s.expect.some(
      (e) =>
        e.scope?.scope === call?.scope &&
        e.scope?.agent === call?.agent &&
        e.ruleId === 'default_unverifiable' &&
        e.state === 'FINAL',
    )
  );
};

export const V14_RULES: readonly (readonly [tag: string, proof: Proof])[] = [
  ['vague_claim_no_adjacency_suppression', vagueClaimNoSuppression],
  ['calendar_anchor_first_seen', calendarAnchorFirstSeen],
  ['per_source_coverage', perSourceCoverage],
  ['scope_receipt_inputs', scopeReceiptInputs],
  ['claim_after_evaluated_ignored', claimAfterEvaluatedIgnored],
  ['grant_latest_updated_at', grantLatestUpdatedAt],
  ['claimless_default_orphan', claimlessDefaultOrphan],
  ['claimless_default_scope', claimlessDefaultScope],
  ...EVENT_RULES,
];
