/**
 * Core perf bench (sprint task 1.3; ledger_engineer rule 9; qa_tester rule 7): candidate lookup for 5,000
 * claims over 50,000 observations must take under 2 s in Node.
 *
 * The workload is synthetic and fully deterministic (a seeded mulberry32 generator, no Math.random), so the
 * gate test (extension/tests/unit/core/candidates-perf.spec.ts) and this bench measure the same thing. The
 * bench times only the lookup (index construction is reported separately), takes the median of 5 runs, and
 * writes bench/results/core-<yyyy-mm-dd>.json for `pnpm bench` to render into RESULTS.md (Hard Rule 12).
 * The gate is the wall-clock median; the lookup's CPU time (the clock the gate test uses inside a parallel
 * suite) is reported beside it.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { candidates, createMemoryIndex, type ObservationIndex } from '../extension/src/core/candidates';
import { DEFAULT_POLICY } from '../extension/src/core/policy';
import { type ActionType, Observation, type ClaimPrecision } from '../extension/src/core/schema';
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

/** A schema-valid id/hash from a counter: decimal digits are valid Crockford base32 and hex. */
const idOf = (n: number): string => String(n).padStart(26, '0');
const hashOf = (n: number): string => n.toString(16).padStart(64, '0');

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

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

const round = (ms: number): number => Math.round(ms * 10) / 10;

/** The calendar date of `now` in the machine's own time zone (the bench may read the clock; core may not). */
function localDate(now: Date): string {
  return `${String(now.getFullYear())}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * Each run rebuilds the (identical, seeded) workload as fresh objects, so no run reuses parses memoised by
 * an earlier one: every run's build and lookup are cold.
 */
async function measure(): Promise<Record<string, number | string | boolean>> {
  const builds: number[] = [];
  const lookups: number[] = [];
  const lookupCpus: number[] = [];
  const totals = new Set<number>();
  const sizes = { observations: 0, claims: 0 };
  for (let run = 0; run < RUNS; run += 1) {
    const workload = buildCoreWorkload();
    sizes.observations = workload.observations.length;
    sizes.claims = workload.claims.length;
    const builtAt = performance.now();
    const index = buildIndex(workload);
    const cpuBefore = process.cpuUsage();
    const lookedUpAt = performance.now();
    const results = await lookupAll(workload, index);
    const doneAt = performance.now();
    const cpu = process.cpuUsage(cpuBefore);
    builds.push(lookedUpAt - builtAt);
    lookups.push(doneAt - lookedUpAt);
    lookupCpus.push((cpu.user + cpu.system) / MICROSECONDS_PER_MS);
    totals.add(results.reduce((sum, list) => sum + list.length, 0));
  }
  if (totals.size !== 1) throw new Error('core bench: runs disagree on the candidate count');
  const lookupMedianMs = round(median(lookups));
  return {
    observations: sizes.observations,
    claims: sizes.claims,
    runs: RUNS,
    bucketMinutes: BUCKET_MINUTES,
    lookupMedianMs,
    lookupMinMs: round(Math.min(...lookups)),
    lookupMaxMs: round(Math.max(...lookups)),
    lookupCpuMedianMs: round(median(lookupCpus)),
    indexBuildMedianMs: round(median(builds)),
    buildPlusLookupMedianMs: round(median(builds.map((build, i) => build + (lookups[i] ?? Number.NaN)))),
    candidatesReturned: [...totals][0] ?? 0,
    gateMs: GATE_MS,
    gatePassed: lookupMedianMs < GATE_MS,
    node: process.version,
  };
}

/** Runs the bench and writes bench/results/core-<date>.json. */
export async function runCoreBench(): Promise<void> {
  const metrics = await measure();
  const date = localDate(new Date());
  const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
  const file = path.join(resultsDir, `core-${date}.json`);
  const result = { bench: 'core', date, command: 'pnpm bench', metrics };
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `core: lookup median ${String(metrics.lookupMedianMs)} ms → ${path.relative(process.cwd(), file)}`,
  );
}
