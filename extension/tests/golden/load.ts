/**
 * Golden scenario loader (docs/grading.md §15). Reads tests/golden/NN-slug.json, applies the documented
 * defaults, computes every id and hash with src/core/hash.ts (no id or hash is ever typed by hand), and
 * parses every built object with the core schemas, so what it returns is exactly what grade()/gradeBatch()
 * accept. The runner (a later wave) calls the core with these objects; this file never grades anything.
 *
 * Defaults (§15): claim extractor {golden, 1, 1}, sourceKind activity_view, claimedAtPrecision minute,
 * observedAt = claimedAt, text = ref; observation observedAt = the earliest lastSyncAt ≤ evaluatedAt among
 * its source's coverage entries whose window contains occurredAt, else evaluatedAt; grant: every type, no
 * allowlist, no ceiling, no scopes, no accounts, updatedAt = evaluatedAt − 1 day; activity: empty lists and
 * every scenario claim. Labels (accountHash, accounts, rowKey) become SHA-256(label).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import defaultPolicyJson from '../../../policy/default.json';
import { hashCanonical, idFromHash } from '../../src/core/hash';
import {
  Activity,
  type AgentId,
  type Claim,
  type Coverage,
  type Grant,
  type GradeContext,
  IsoTs,
  type Observation,
  Ulid,
} from '../../src/core/schema';
import { buildClaim, buildCoverage, buildGrant, buildObservation, mergePatch, PolicyView } from './build';
import { type ExpectedReceipt, Scenario, type ScenarioEvent } from './scenario-schema';

export {
  buildClaim,
  buildCoverage,
  buildGrant,
  buildObservation,
  contentHashOf,
  defaultObservedAt,
  labelHash,
  mergePatch,
  PolicyView,
} from './build';

export const GOLDEN_DIR = import.meta.dirname;
export const SCENARIO_FILE = /^(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;

export type GoldenLoadErrorCode = 'unknown_ref' | 'duplicate_ref' | 'missing_agent';

export class GoldenLoadError extends Error {
  constructor(
    readonly code: GoldenLoadErrorCode,
    readonly detail: string,
  ) {
    super(`golden ${code}: ${detail}`);
    this.name = 'GoldenLoadError';
  }
}

/** One fixed pre-assignment: observation → claim; `claimId: null` = an overridden UNASKED receipt. */
export interface BuiltFixed {
  observationId: Ulid;
  claimId: Ulid | null;
}

export interface BuiltGradeCall {
  claim: Claim | null;
  candidates: Observation[];
  /** The agent whose grant applies (the claim's agent, or the named agent for a claim-less call). */
  agent: AgentId;
  /** Without attribution: see `attributeFromActivity`. */
  context: GradeContext;
  /** Claim-less call with activity: context.attribution = attribute(candidates[0], activity, policy). */
  attributeFromActivity: boolean;
}

export type BuiltEvent =
  | { event: 'override'; receiptId: Ulid; grade: 'VERIFIED' | 'NOT_FOUND'; reason: string; at: IsoTs }
  | { event: 'supersede'; receiptId: Ulid; claimId: Ulid };

/** The receipt subject (§3): the receipt id is idFromHash(sha256(canonicalJson(subject))). */
export type ReceiptSubject =
  | { k: 'claim'; claimId: string }
  | { k: 'unasked'; observationId: string }
  | { k: 'scope'; agent: AgentId; scope: string };

export interface ResolvedExpect {
  receiptId: Ulid;
  subject: ReceiptSubject;
  observationIds: Ulid[];
  supersededById?: Ulid;
  expected: ExpectedReceipt;
}

export interface LoadedScenario {
  file: string;
  scenario: Scenario;
  /** policy/default.json with the scenario's policyPatch applied (RFC 7386); the runner calls loadPolicy. */
  policyJson: unknown;
  policy: PolicyView;
  evaluatedAt: IsoTs;
  claims: ReadonlyMap<string, Claim>;
  observations: ReadonlyMap<string, Observation>;
  /** mode "batch": the claims passed to gradeBatch (claims named in `fixed` already hold a FINAL receipt). */
  batchClaims: Claim[];
  grants: Grant[];
  coverage: Coverage;
  activity: Activity;
  fixed: BuiltFixed[];
  gradeCall?: BuiltGradeCall;
  events: BuiltEvent[];
  expected: ResolvedExpect[];
}

export function receiptIdFor(subject: ReceiptSubject): Ulid {
  return Ulid.parse(idFromHash(hashCanonical(subject)));
}

function indexByRef<T extends { ref: string }, B>(
  items: readonly T[],
  build: (item: T) => B,
): Map<string, B> {
  const out = new Map<string, B>();
  for (const item of items) {
    if (out.has(item.ref)) throw new GoldenLoadError('duplicate_ref', item.ref);
    out.set(item.ref, build(item));
  }
  return out;
}

function lookup<B>(map: ReadonlyMap<string, B>, ref: string): B {
  const found = map.get(ref);
  if (found === undefined) throw new GoldenLoadError('unknown_ref', ref);
  return found;
}

interface Built {
  claims: ReadonlyMap<string, Claim>;
  observations: ReadonlyMap<string, Observation>;
}

const claimId = (built: Built, ref: string): Ulid => lookup(built.claims, ref).id;
const observationId = (built: Built, ref: string): Ulid => lookup(built.observations, ref).id;

function subjectOfRef(built: Built, ref: string): ReceiptSubject {
  return ref.startsWith('c')
    ? { k: 'claim', claimId: claimId(built, ref) }
    : { k: 'unasked', observationId: observationId(built, ref) };
}

function resolveExpect(built: Built, expected: ExpectedReceipt): ResolvedExpect {
  const subject: ReceiptSubject =
    expected.scope === undefined
      ? subjectOfRef(built, expected.ref ?? '')
      : { k: 'scope', ...expected.scope };
  return {
    receiptId: receiptIdFor(subject),
    subject,
    observationIds: expected.observationRefs.map((ref) => observationId(built, ref)),
    ...(expected.supersededBy === undefined ? {} : { supersededById: claimId(built, expected.supersededBy) }),
    expected,
  };
}

function buildEvent(built: Built, event: ScenarioEvent): BuiltEvent {
  const receiptId = receiptIdFor(subjectOfRef(built, event.ref));
  if (event.event === 'supersede')
    return { event: 'supersede', receiptId, claimId: claimId(built, event.claim) };
  return {
    event: 'override',
    receiptId,
    grade: event.grade,
    reason: event.reason,
    at: IsoTs.parse(event.at),
  };
}

function buildActivity(scenario: Scenario, built: Built): Activity {
  const activity = scenario.input.activity ?? {};
  const claimRefs = activity.claims ?? scenario.input.claims.map((claim) => claim.ref);
  return Activity.parse({
    sessions: activity.sessions ?? [],
    idle: activity.idle ?? [],
    entries: activity.entries ?? [],
    adapterSyncs: activity.adapterSyncs ?? [],
    claims: claimRefs.map((ref) => lookup(built.claims, ref)),
  });
}

function buildGradeCall(scenario: Scenario, built: Built): BuiltGradeCall | undefined {
  const call = scenario.input.grade;
  if (call === undefined) return undefined;
  const claim = call.claim === null ? null : lookup(built.claims, call.claim);
  const agent = call.agent ?? claim?.agent;
  if (agent === undefined)
    throw new GoldenLoadError('missing_agent', 'a claim-less grade call names its agent');
  return {
    claim,
    candidates: call.candidates.map((ref) => lookup(built.observations, ref)),
    agent,
    context: {
      priorSpendCents: call.priorSpendCents ?? 0,
      ...(call.scope === undefined ? {} : { scope: { observed: call.scope } }),
    },
    attributeFromActivity: claim === null && scenario.input.activity !== undefined,
  };
}

export function parseScenarioText(text: string): Scenario {
  return Scenario.parse(JSON.parse(text));
}

export function readScenario(file: string): Scenario {
  return parseScenarioText(readFileSync(path.join(GOLDEN_DIR, file), 'utf8'));
}

/** Every .json file directly in tests/golden, sorted (each must be a scenario named NN-slug.json). */
export function scenarioFiles(): string[] {
  return readdirSync(GOLDEN_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function buildRefs(scenario: Scenario, policy: PolicyView): Built {
  const { evaluatedAt, coverage } = scenario.input;
  return {
    claims: indexByRef(scenario.input.claims, buildClaim),
    observations: indexByRef(scenario.input.observations, (o) =>
      buildObservation(o, coverage, evaluatedAt, policy),
    ),
  };
}

export function buildScenario(file: string, scenario: Scenario): LoadedScenario {
  const policyJson = mergePatch(defaultPolicyJson, scenario.policyPatch ?? {});
  const policy = PolicyView.parse(policyJson);
  const { evaluatedAt, coverage, fixed = [] } = scenario.input;
  const built = buildRefs(scenario, policy);
  const fixedClaims = new Set(fixed.flatMap((pair) => (pair.claim === null ? [] : [pair.claim])));
  const gradeCall = buildGradeCall(scenario, built);
  return {
    file,
    scenario,
    policyJson,
    policy,
    evaluatedAt: IsoTs.parse(evaluatedAt),
    ...built,
    batchClaims: scenario.input.claims
      .filter((claim) => !fixedClaims.has(claim.ref))
      .map((claim) => lookup(built.claims, claim.ref)),
    grants: scenario.input.grants.map((grant) => buildGrant(grant, evaluatedAt)),
    coverage: buildCoverage(coverage, evaluatedAt),
    activity: buildActivity(scenario, built),
    fixed: fixed.map((pair) => ({
      observationId: observationId(built, pair.observation),
      claimId: pair.claim === null ? null : claimId(built, pair.claim),
    })),
    ...(gradeCall === undefined ? {} : { gradeCall }),
    events: (scenario.events ?? []).map((event) => buildEvent(built, event)),
    expected: scenario.expect.map((expected) => resolveExpect(built, expected)),
  };
}

export function loadScenario(file: string): LoadedScenario {
  return buildScenario(file, readScenario(file));
}
