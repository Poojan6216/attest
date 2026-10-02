/**
 * Core perf bench (sprint tasks 1.3 and 1.5; ledger_engineer rule 9; qa_tester rule 7): over 5,000 claims and
 * 50,000 observations, candidate lookup and the whole `gradeBatch` must each take under 2 s in Node. Workloads
 * are synthetic and deterministic (seeded mulberry32, no Math.random), so the gate tests (tests/perf/
 * candidates.perf.spec.ts, grading.perf.spec.ts) measure what this bench measures. Each figure is the wall-clock
 * median of 5 cold runs, with the CPU median beside it (the gates' clock inside a parallel suite), written to
 * bench/results/core-<yyyy-mm-dd>.json for `pnpm bench` to render into RESULTS.md (Hard Rule 12). Grading reuses
 * the lookup's observations and claim timings; a second seeded stream gives each claim an agent and an identity
 * (40% restate a real observation, 10% are vague), plus one coverage pass per source per day, a grant per agent
 * bound to one account, and modest agent activity, so some orphans become UNASKED.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BatchReceipt, gradeBatch } from '../extension/src/core/batch';
import { candidates, createMemoryIndex, type ObservationIndex } from '../extension/src/core/candidates';
import { idFromHash } from '../extension/src/core/hash';
import { DEFAULT_POLICY } from '../extension/src/core/policy';
import { Activity, Claim, Coverage, Grant, Observation } from '../extension/src/core/schema';
import type { ActionType, ClaimPrecision, Receipt } from '../extension/src/core/schema';
import type { WindowClaim } from '../extension/src/core/window';

export const OBSERVATION_COUNT = 50_000;
export const CLAIM_COUNT = 5_000;
/** The gate: lookup for every claim must take less than this (sprint 1 task 1.3). */
export const GATE_MS = 2_000;
/** The memory index's bucket width; a tuning parameter of the index, not policy. */
export const BUCKET_MINUTES = 15;
const RUNS = 5;
const SEED = 0x5eed_1_3;

const MS_PER_MINUTE = 60_000;
const MICROSECONDS_PER_MS = 1_000;
const MS_PER_DAY = 86_400_000;
const START_MS = Date.parse('2026-09-01T00:00:00Z');
const SPAN_DAYS = 30;
/** Offsets the timestamps are written in, so parsing never sees one shape only. */
const OFFSETS = [-240, 0, 330, -420] as const;

/** Type mix of both observations and claims: [type, cumulative weight out of 100]. */
const TYPE_MIX: readonly (readonly [ActionType, number])[] = [
  ['email.sent', 60],
  ['calendar.created', 65],
  ['calendar.updated', 68],
  ['calendar.deleted', 70],
  ['purchase.made', 85],
  ['subscription.changed', 95],
  ['listing.posted', 100],
];

/** mulberry32: a tiny, well-known 32-bit PRNG. Same seed, same sequence, on every machine. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

function typeOf(random: () => number): ActionType {
  const roll = random() * 100;
  return (TYPE_MIX.find(([, upTo]) => roll < upTo) ?? TYPE_MIX[0] ?? ['email.sent'])[0];
}

const two = (value: number): string => String(value).padStart(2, '0');

/** `ms` written in local time at `offsetMinutes` with an explicit ±hh:mm offset (UTC arithmetic only). */
export function isoAt(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 23);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  return `${local}${sign}${two(Math.floor(magnitude / 60))}:${two(magnitude % 60)}`;
}

function sourceOf(type: ActionType): 'gmail.sent' | 'gmail.receipt' | 'gcal.event' {
  if (type === 'email.sent') return 'gmail.sent';
  return type.startsWith('calendar.') ? 'gcal.event' : 'gmail.receipt';
}

/**
 * A schema-valid hash from a counter, and the id §10 derives from it (`Observation.id = idFromHash(contentHash)`).
 * The counter fills the leading 128 bits (the ones `idFromHash` reads), so ids are distinct and ascend with it.
 */
const hashOf = (n: number): string => n.toString(16).padStart(32, '0').repeat(2);
const idOf = (n: number): string => idFromHash(hashOf(n));

function randomMs(random: () => number): number {
  return START_MS + Math.floor(random() * SPAN_DAYS * MS_PER_DAY);
}

function observationAt(random: () => number, n: number): Observation {
  const type = typeOf(random);
  const occurredMs = randomMs(random);
  const offset = pick(random, OFFSETS);
  const isCalendar = type.startsWith('calendar.');
  const seenMs = isCalendar
    ? occurredMs - Math.floor(random() * 5 * MS_PER_DAY)
    : occurredMs + Math.floor(random() * 60 * MS_PER_MINUTE);
  const isReceipt = sourceOf(type) === 'gmail.receipt';
  return Observation.parse({
    id: idOf(n),
    source: sourceOf(type),
    type,
    ...(isReceipt
      ? { merchant: `merchant ${String(n % 200)}`, amountCents: n % 10_000, currency: 'USD' }
      : { counterparty: `person${String(n % 500)}@example${String(n % 7)}.com` }),
    subjectHint: `subject ${String(n % 1_000)}`,
    occurredAt: isoAt(occurredMs, offset),
    observedAt: isoAt(seenMs, offset),
    contentHash: hashOf(n),
  });
}

/** 2% of rows are re-sightings: the same row (id, contentHash) seen again later. */
function resighting(random: () => number, original: Observation): Observation {
  const laterMs = Date.parse(original.observedAt) + Math.floor(random() * MS_PER_DAY);
  return Observation.parse({ ...original, observedAt: isoAt(laterMs, 0) });
}

function claimAt(random: () => number): WindowClaim {
  const type = typeOf(random);
  const roll = random();
  const precision: ClaimPrecision = roll < 0.8 ? 'minute' : roll < 0.95 ? 'hour' : 'day';
  const claimedAt = isoAt(randomMs(random), pick(random, OFFSETS));
  if (!type.startsWith('calendar.')) return { type, claimedAt, claimedAtPrecision: precision };
  if (random() < 0.1) return { type, claimedAt, claimedAtPrecision: precision };
  return { type, claimedAt, claimedAtPrecision: precision, targetAt: isoAt(randomMs(random), 0) };
}

export interface CoreWorkload {
  readonly observations: readonly Observation[];
  readonly claims: readonly WindowClaim[];
}

/** The deterministic workload: OBSERVATION_COUNT observations (2% re-sightings) and CLAIM_COUNT claims. */
export function buildCoreWorkload(seed = SEED): CoreWorkload {
  const random = seededRandom(seed);
  const observations: Observation[] = [];
  for (let n = 0; observations.length < OBSERVATION_COUNT; n += 1) {
    const previous = observations[observations.length - 1];
    if (previous !== undefined && random() < 0.02) observations.push(resighting(random, previous));
    else observations.push(observationAt(random, n));
  }
  const claims = Array.from({ length: CLAIM_COUNT }, () => claimAt(random));
  return { observations, claims };
}

export function buildIndex(workload: CoreWorkload): ObservationIndex {
  return createMemoryIndex(workload.observations, BUCKET_MINUTES);
}

/** Candidate lookup for every claim; returns the candidates per claim (in claim order). */
export async function lookupAll(workload: CoreWorkload, index: ObservationIndex): Promise<Observation[][]> {
  const results: Observation[][] = [];
  for (const claim of workload.claims) results.push(await candidates(claim, index, DEFAULT_POLICY));
  return results;
}

// ── Grading workload (task 1.5) ──────────────────────────────────────────────────────────────────

const AGENTS = ['muse', 'chatgpt', 'dots', 'claude'] as const;
const SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
const MS_PER_HOUR = 3_600_000;
/** Claim ids and raw hashes count up from here, clear of the observation counter. */
const CLAIM_BASE = 10_000_000;
const ACCOUNT = hashOf(0xacc0);
const EVALUATED_MS = START_MS + (SPAN_DAYS + 1) * MS_PER_DAY;
/** Shares of claims that restate a real observation and that are vague; activity sizes over the span. */
const SHARES = { honest: 0.4, vague: 0.1 } as const;
const ACTIVITY = { sessions: 960, idle: 60, entries: 480 } as const;

export interface GradingWorkload {
  readonly observations: readonly Observation[];
  readonly claims: readonly Claim[];
  readonly grants: readonly Grant[];
  readonly coverage: Coverage;
  readonly activity: Activity;
}

/** A claim restating observation `o` (same type, time and identity): what an honest agent reports. */
function honestFields(o: Observation): Record<string, unknown> {
  const { counterparty = o.merchant, amountCents, currency, subjectHint } = o;
  const identity = Object.entries({ counterparty, amountCents, currency, subjectHint });
  const timing = o.type.startsWith('calendar.') ? { claimedAt: o.observedAt, targetAt: o.occurredAt } : {};
  const present = Object.fromEntries(identity.filter(([, value]) => value !== undefined));
  return { type: o.type, claimedAt: o.occurredAt, ...timing, ...present };
}

/** A claim at a 1.3 claim timing naming a random counterparty (most match nothing in their window). */
function randomFields(random: () => number, timing: WindowClaim): Record<string, unknown> {
  const n = Math.floor(random() * OBSERVATION_COUNT);
  const isReceipt = sourceOf(timing.type) === 'gmail.receipt';
  return {
    ...timing,
    ...(isReceipt
      ? { counterparty: `merchant ${String(n % 200)}`, amountCents: n % 10_000, currency: 'USD' }
      : { counterparty: `person${String(n % 500)}@example${String(n % 7)}.com` }),
    subjectHint: `subject ${String(n % 1_000)}`,
  };
}

function gradingClaim(random: () => number, i: number, timing: WindowClaim, obs: readonly Observation[]) {
  const roll = random();
  const restated = obs[Math.floor(random() * obs.length)];
  const fields =
    roll < SHARES.honest && restated !== undefined
      ? { claimedAtPrecision: 'minute', ...honestFields(restated) }
      : roll < SHARES.honest + SHARES.vague
        ? { ...timing }
        : randomFields(random, timing);
  const claimedAt = String(fields.claimedAt);
  return Claim.parse({
    id: idOf(CLAIM_BASE + i),
    agent: pick(random, AGENTS),
    ...fields,
    observedAt: claimedAt,
    sourceKind: 'activity_view',
    extractor: { id: 'bench', version: '1', confidence: 1 },
    rawHash: hashOf(CLAIM_BASE + i),
  });
}

/** One pass per source per day, seeing that day plus an hour; the last day's pass is after evaluatedAt. */
function gradingCoverage(): Coverage {
  const observers = SOURCES.flatMap((source) =>
    Array.from({ length: SPAN_DAYS + 1 }, (_, day) => {
      const fromMs = START_MS + day * MS_PER_DAY;
      const toMs = fromMs + MS_PER_DAY + MS_PER_HOUR;
      const calendars = source === 'gcal.event' ? { allCalendars: true } : {};
      const at = { lastSyncAt: isoAt(toMs, 0), windowStart: isoAt(fromMs, 0), windowEnd: isoAt(toMs, 0) };
      return { observerId: source, source, ...at, accountHash: ACCOUNT, ...calendars };
    }),
  );
  return Coverage.parse({ evaluatedAt: isoAt(EVALUATED_MS, 0), observers });
}

function gradingGrants(): Grant[] {
  return AGENTS.map((agent) =>
    Grant.parse({
      agent,
      allowedTypes: TYPE_MIX.map(([type]) => type),
      counterpartyAllowlist: [],
      spendCeilingCents: agent === 'muse' ? 500_000 : null,
      ...(agent === 'muse' ? { spendCurrency: 'USD' } : {}),
      declaredScopes: ['gmail.send'],
      observedScopes: agent === 'dots' ? ['gmail.send', 'gmail.read'] : ['gmail.send'],
      accounts: Object.fromEntries(SOURCES.map((source) => [source, [ACCOUNT]])),
      updatedAt: isoAt(START_MS - MS_PER_DAY, 0),
    }),
  );
}

/** Session pings, idle spans of 5–60 minutes, activity-log entries, one adapter sync per agent. */
function gradingActivity(random: () => number, claims: readonly Claim[]): Activity {
  const agentAt = () => ({ agent: pick(random, AGENTS), at: isoAt(randomMs(random), 0) });
  const idle = () => {
    const fromMs = randomMs(random);
    return { from: isoAt(fromMs, 0), to: isoAt(fromMs + (5 + Math.floor(random() * 55)) * MS_PER_MINUTE, 0) };
  };
  return Activity.parse({
    sessions: Array.from({ length: ACTIVITY.sessions }, agentAt),
    idle: Array.from({ length: ACTIVITY.idle }, idle),
    entries: Array.from({ length: ACTIVITY.entries }, agentAt),
    adapterSyncs: AGENTS.map((agent) => ({ agent, lastSyncAt: isoAt(EVALUATED_MS - MS_PER_HOUR, 0) })),
    claims,
  });
}

/** The deterministic grading workload: the 1.3 observations and claim timings, plus everything grading reads. */
export function buildGradingWorkload(seed = SEED): GradingWorkload {
  const core = buildCoreWorkload(seed);
  const random = seededRandom(seed + 1);
  const claims = core.claims.map((timing, i) => gradingClaim(random, i, timing, core.observations));
  const activity = gradingActivity(random, claims);
  return { ...core, claims, grants: gradingGrants(), coverage: gradingCoverage(), activity };
}

/** `gradeBatch` over the whole workload (all PENDING, nothing fixed, shipped policy): receipts with their inputs. */
export async function gradeAll(workload: GradingWorkload, index: ObservationIndex): Promise<BatchReceipt[]> {
  const { claims, grants, coverage, activity } = workload;
  return gradeBatch(claims, index, grants, DEFAULT_POLICY, coverage, activity);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** The calendar date of `now` in the machine's own time zone (the bench may read the clock; core may not). */
function localDate(now: Date): string {
  return `${String(now.getFullYear())}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

interface Timed<T> {
  readonly wallMs: number;
  readonly cpuMs: number;
  readonly result: T;
}

/** Wall and CPU time of `act` (user + system CPU of this process). */
async function timed<T>(act: () => T | Promise<T>): Promise<Timed<T>> {
  const cpuBefore = process.cpuUsage();
  const startedAt = performance.now();
  const result = await act();
  const wallMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuBefore);
  return { wallMs, cpuMs: (cpu.user + cpu.system) / MICROSECONDS_PER_MS, result };
}

/**
 * Each run rebuilds the (identical, seeded) workload as fresh objects, so no run reuses parses memoised by
 * an earlier one: every run's build and lookup are cold.
 */
async function measure(): Promise<Record<string, number | string | boolean>> {
  const builds: number[] = [];
  const lookups: Timed<Observation[][]>[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const workload = buildCoreWorkload();
    const built = await timed(() => buildIndex(workload));
    builds.push(built.wallMs);
    lookups.push(await timed(() => lookupAll(workload, built.result)));
  }
  const totals = new Set(lookups.map(({ result }) => result.reduce((sum, list) => sum + list.length, 0)));
  if (totals.size !== 1) throw new Error('core bench: runs disagree on the candidate count');
  const walls = lookups.map((lookup) => lookup.wallMs);
  const lookupMedianMs = round(median(walls));
  return {
    observations: OBSERVATION_COUNT,
    claims: CLAIM_COUNT,
    runs: RUNS,
    bucketMinutes: BUCKET_MINUTES,
    lookupMedianMs,
    lookupMinMs: round(Math.min(...walls)),
    lookupMaxMs: round(Math.max(...walls)),
    lookupCpuMedianMs: round(median(lookups.map((lookup) => lookup.cpuMs))),
    indexBuildMedianMs: round(median(builds)),
    buildPlusLookupMedianMs: round(median(builds.map((build, i) => build + (walls[i] ?? Number.NaN)))),
    candidatesReturned: [...totals][0] ?? 0,
    gateMs: GATE_MS,
    gatePassed: lookupMedianMs < GATE_MS,
    node: process.version,
  };
}

/** Receipt counts by kind, so a run that grades nothing (a vacuous fast path) shows in the result file. */
function receiptCounts(graded: readonly BatchReceipt[]): Record<string, number> {
  const receipts = graded.map((entry) => entry.receipt);
  const count = (grade: Receipt['grade']) => receipts.filter((r) => r.grade === grade).length;
  const verified = { gradingVerified: count('VERIFIED'), gradingNotFound: count('NOT_FOUND') };
  return { gradingReceipts: receipts.length, ...verified, gradingUnasked: count('UNASKED') };
}

/** `gradeBatch` over the grading workload: median of RUNS cold runs (fresh objects and index each run). */
async function measureGrading(): Promise<Record<string, number | boolean>> {
  const runs: Timed<BatchReceipt[]>[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const workload = buildGradingWorkload();
    const index = createMemoryIndex(workload.observations, BUCKET_MINUTES);
    runs.push(await timed(() => gradeAll(workload, index)));
  }
  const counts = runs.map(({ result }) => receiptCounts(result));
  const agree = new Set(counts.map((c) => JSON.stringify(c))).size === 1;
  if (!agree) throw new Error('core bench: grading runs disagree on the receipts');
  const walls = runs.map((graded) => graded.wallMs);
  const gradingMedianMs = round(median(walls));
  return {
    gradingMedianMs,
    gradingMinMs: round(Math.min(...walls)),
    gradingMaxMs: round(Math.max(...walls)),
    gradingCpuMedianMs: round(median(runs.map((graded) => graded.cpuMs))),
    ...counts[0],
    gradingGateMs: GATE_MS,
    gradingGatePassed: gradingMedianMs < GATE_MS,
  };
}

/** Runs the bench and writes bench/results/core-<date>.json. */
export async function runCoreBench(): Promise<void> {
  const metrics = { ...(await measure()), ...(await measureGrading()) };
  const date = localDate(new Date());
  const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
  const file = path.join(resultsDir, `core-${date}.json`);
  const result = { bench: 'core', date, command: 'pnpm bench', metrics };
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  const summary = `lookup median ${String(metrics.lookupMedianMs)} ms, grading median ${String(metrics.gradingMedianMs)} ms`;
  console.log(`core: ${summary} → ${path.relative(process.cwd(), file)}`);
}
