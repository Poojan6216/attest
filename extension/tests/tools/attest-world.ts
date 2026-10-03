/**
 * A synthetic world for the replay tests and the `attest replay` CLI tests: schema-valid claims, observations,
 * grants, coverage passes, activity, batch instants and two policy versions, all from one seed (mulberry32; no
 * Math.random, so a failing seed reproduces). attest-ledger.ts grades it batch by batch the way the background does.
 *
 * The mix is built to reach every path replay must rebuild: honest claims restating an observation (VERIFIED,
 * sometimes two claims after one observation, so assignment matters), random claims (PARTIAL by domain, NOT_FOUND),
 * vague claims and claims of a type with no sources (UNVERIFIABLE at once), calendar claims (with and without a
 * target), purchases against a spend ceiling and a currency, an agent whose accounts are unbound (coverage capped,
 * PENDING until `finalizeUnverifiableHours`), coverage passes with gaps, an undeclared observed scope (OVER_SCOPE
 * scope receipts), an allowlist, a disallowed type, a grant that changes mid-ledger, a policy that changes
 * mid-ledger, activity that makes some orphans UNASKED, and a few rows read by an observer the policy does not list
 * for their type (never a candidate nor an orphan, even in a window of their own source: §3, §4.1).
 */
import defaultPolicyJson from '../../../policy/default.json';

import { canonicalJson, idFromHash, sha256Hex } from '../../src/core/hash';
import { loadPolicy, type Policy } from '../../src/core/policy';
import {
  type ActionType,
  Activity,
  AgentId,
  Claim,
  Grant,
  Observation,
  ObserverCoverage,
} from '../../src/core/schema';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;
export const START_MS = Date.parse('2026-09-01T00:00:00Z');
const SPAN_DAYS = 4;
const SPAN_MS = SPAN_DAYS * MS_PER_DAY;
/** Offsets timestamps are written in, so instants are never compared as strings. */
const OFFSETS = [-240, 0, 330, -420] as const;
const AGENTS = AgentId.options;
const SOURCES = ['gmail.sent', 'gmail.receipt', 'gcal.event'] as const;
/** Claim raw hashes count from here, clear of the observation counter. */
const CLAIM_BASE = 10_000_000;
const PERSONS = 120;
const DOMAINS = 7;
const MERCHANTS = 40;
const SUBJECTS = 300;
const PASS_EVERY_MS = 3 * MS_PER_HOUR;
const PASS_WINDOW_MS = 4 * MS_PER_HOUR;
/** The share of coverage passes skipped: each skip leaves a gap that caps coverage at partial. */
const PASS_SKIP = 0.08;
/** The share of observations read by a source the policy does not list for their type (§3: never orphans). */
const STRAY_SOURCE = 0.05;
type Source = (typeof SOURCES)[number];

/** Type mix of observations and of non-vague claims: [type, cumulative weight out of 100]. */
const TYPE_MIX: readonly (readonly [ActionType, number])[] = [
  ['email.sent', 55],
  ['calendar.created', 62],
  ['calendar.updated', 66],
  ['calendar.deleted', 69],
  ['purchase.made', 84],
  ['subscription.changed', 94],
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

export type Random = () => number;

export function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

const two = (value: number): string => String(value).padStart(2, '0');

/** `ms` written at `offsetMinutes` with an explicit ±hh:mm offset (UTC arithmetic only, never local time). */
export function isoAt(ms: number, offsetMinutes = 0): string {
  const local = new Date(ms + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 23);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(offsetMinutes);
  return `${local}${sign}${two(Math.floor(magnitude / 60))}:${two(magnitude % 60)}`;
}

/** A schema-valid SHA-256 from a counter: the counter fills the 128 bits `idFromHash` reads, so ids are distinct. */
export const hashOf = (n: number): string => n.toString(16).padStart(32, '0').repeat(2);
/** The account every bound observer pass reports. */
export const ACCOUNT = hashOf(0xacc0);

function typeOf(random: Random): ActionType {
  const roll = random() * 100;
  return (TYPE_MIX.find(([, upTo]) => roll < upTo) ?? ['email.sent'])[0];
}

export function sourceOf(type: ActionType): Source {
  if (type === 'email.sent') return 'gmail.sent';
  return type.startsWith('calendar.') ? 'gcal.event' : 'gmail.receipt';
}

const person = (k: number): string => `person${String(k % PERSONS)}@example${String(k % DOMAINS)}.com`;
const merchant = (k: number): string => `merchant ${String(k % MERCHANTS)}`;

/** The counterparty and money a row from `source` holds: an address, or a merchant with an amount. */
function identity(random: Random, source: Source): Record<string, unknown> {
  const k = Math.floor(random() * PERSONS * MERCHANTS);
  if (source !== 'gmail.receipt') return { counterparty: person(k) };
  const currency = random() < 0.9 ? 'USD' : 'EUR';
  return { merchant: merchant(k), amountCents: 100 + Math.floor(random() * 90_000), currency };
}

/**
 * Observation number `n` with the given content fields, `occurredAt` and `observedAt`, hashed as redact.ts
 * `project` hashes a row (§10): `contentHash` = SHA-256 of the canonical JSON of `{source, type, ...content,
 * rowKeyHash}`, `id = idFromHash(contentHash)`, `source` from the type unless given. The row key is the counter, so
 * two observations with the same content stay two (as two identical sends do).
 */
export function buildObservation(
  n: number,
  fields: Record<string, unknown> & { type: ActionType; observedAt: string; source?: Source },
): Observation {
  const { observedAt, source = sourceOf(fields.type), ...content } = fields;
  const hashed = { source, ...content, rowKeyHash: hashOf(n) };
  const contentHash = sha256Hex(canonicalJson(hashed));
  return Observation.parse({ ...hashed, id: idFromHash(contentHash), observedAt, contentHash });
}

/** The type's own source, or for a `STRAY_SOURCE` share of rows another one. */
function sourceFor(random: Random, type: ActionType): Source {
  const own = sourceOf(type);
  return random() < STRAY_SOURCE
    ? pick(
        random,
        SOURCES.filter((source) => source !== own),
      )
    : own;
}

export function makeObservation(random: Random, n: number): Observation {
  const type = typeOf(random);
  const source = sourceFor(random, type);
  const occurredMs = START_MS + Math.floor(random() * SPAN_MS);
  const offset = pick(random, OFFSETS);
  const seenMs = type.startsWith('calendar.')
    ? occurredMs - Math.floor(random() * 2 * MS_PER_DAY)
    : occurredMs + Math.floor(random() * 90 * MS_PER_MINUTE);
  return buildObservation(n, {
    type,
    source,
    ...identity(random, source),
    subjectHint: `subject ${String(n % SUBJECTS)}`,
    occurredAt: isoAt(occurredMs, offset),
    observedAt: isoAt(seenMs, offset),
  });
}

/** A claim restating observation `o` (same type, time and identity): what an honest agent reports. */
function honestFields(o: Observation): Record<string, unknown> {
  const counterparty = o.counterparty ?? o.merchant;
  const money = o.amountCents === undefined ? {} : { amountCents: o.amountCents, currency: o.currency };
  const timing = o.type.startsWith('calendar.')
    ? { claimedAt: o.observedAt, targetAt: o.occurredAt }
    : { claimedAt: o.occurredAt };
  return {
    type: o.type,
    counterparty,
    subjectHint: o.subjectHint,
    ...money,
    ...timing,
    claimedAtPrecision: 'minute',
  };
}

/** A claim at a random instant naming a random identity (most match nothing, some match by domain). */
function randomFields(random: Random): Record<string, unknown> {
  const type = typeOf(random);
  const roll = random();
  const claimedAtPrecision = roll < 0.8 ? 'minute' : roll < 0.95 ? 'hour' : 'day';
  const claimedAt = isoAt(START_MS + Math.floor(random() * SPAN_MS), pick(random, OFFSETS));
  const found = identity(random, sourceOf(type));
  const counterparty = found.counterparty ?? found.merchant;
  const { amountCents, currency } = found;
  const target = type.startsWith('calendar.') && random() < 0.9;
  return {
    type,
    claimedAt,
    claimedAtPrecision,
    counterparty,
    ...(amountCents === undefined ? {} : { amountCents, currency }),
    subjectHint: `subject ${String(Math.floor(random() * SUBJECTS))}`,
    ...(target ? { targetAt: isoAt(START_MS + Math.floor(random() * SPAN_MS), 0) } : {}),
  };
}

/** Honest 40% (15% of those restate the previous honest claim's observation), vague 10%, no-source 3%, random. */
function claimFields(random: Random, observations: readonly Observation[], last: { o?: Observation }) {
  const roll = random();
  if (roll < 0.4) {
    const o = last.o !== undefined && random() < 0.15 ? last.o : pick(random, observations);
    last.o = o;
    return honestFields(o);
  }
  const claimedAt = isoAt(START_MS + Math.floor(random() * SPAN_MS), pick(random, OFFSETS));
  if (roll < 0.5) return { type: typeOf(random), claimedAt, claimedAtPrecision: 'minute' };
  if (roll < 0.53)
    return { type: 'message.sent', claimedAt, claimedAtPrecision: 'minute', subjectHint: 'hi' };
  return randomFields(random);
}

/**
 * Claim number `i` (§10: `rawHash` from the counter, `id = idFromHash(rawHash)`) with the given fields, which
 * must include `agent`, `type`, `claimedAt` and `observedAt`; precision defaults to minute.
 */
export function buildClaim(i: number, fields: Record<string, unknown>): Claim {
  return Claim.parse({
    id: idFromHash(hashOf(CLAIM_BASE + i)),
    claimedAtPrecision: 'minute',
    ...fields,
    sourceKind: 'activity_view',
    extractor: { id: 'synthetic', version: '1', confidence: 1 },
    rawHash: hashOf(CLAIM_BASE + i),
  });
}

export function makeClaim(random: Random, i: number, fields: Record<string, unknown>): Claim {
  const claimedMs = Date.parse(String(fields.claimedAt));
  const seenMs = claimedMs + (1 + Math.floor(random() * 180)) * MS_PER_MINUTE;
  return buildClaim(i, { agent: pick(random, AGENTS), ...fields, observedAt: isoAt(seenMs, 0) });
}

/** A coverage pass of `source` synced at `syncMs`, seeing the `PASS_WINDOW_MS` before it, bound to ACCOUNT. */
export function makePass(source: Source, syncMs: number, windowMs = PASS_WINDOW_MS) {
  return ObserverCoverage.parse({
    observerId: source,
    source,
    lastSyncAt: isoAt(syncMs, 0),
    windowStart: isoAt(syncMs - windowMs, 0),
    windowEnd: isoAt(syncMs, 0),
    accountHash: ACCOUNT,
    ...(source === 'gcal.event' ? { allCalendars: true } : {}),
  });
}

function makePasses(random: Random, untilMs: number): ObserverCoverage[] {
  const passes: ObserverCoverage[] = [];
  for (const source of SOURCES) {
    for (let atMs = START_MS - 6 * MS_PER_HOUR; atMs <= untilMs; atMs += PASS_EVERY_MS) {
      const jitterMs = Math.floor(random() * 10 * MS_PER_MINUTE);
      if (random() >= PASS_SKIP) passes.push(makePass(source, atMs + jitterMs));
    }
  }
  return passes;
}

const ALL_TYPES = TYPE_MIX.map(([type]) => type);
const BOUND = Object.fromEntries(SOURCES.map((source) => [source, [ACCOUNT]]));

/**
 * One grant per agent, in force from a day before the span, plus a second muse grant (a lower ceiling) from
 * `changeAt`: muse has a spend ceiling, chatgpt unbound accounts (coverage capped at partial), dots an undeclared
 * observed scope and no listings, claude an allowlist and no purchases.
 */
export function makeGrants(changeAtMs: number): Grant[] {
  const since = isoAt(START_MS - MS_PER_DAY, 0);
  const base = { counterpartyAllowlist: [], spendCeilingCents: null, declaredScopes: ['gmail.send'] };
  const grants = [
    { ...base, agent: 'muse', allowedTypes: ALL_TYPES, spendCeilingCents: 60_000, spendCurrency: 'USD' },
    { ...base, agent: 'chatgpt', allowedTypes: ALL_TYPES },
    {
      ...base,
      agent: 'dots',
      allowedTypes: ALL_TYPES.filter((type) => type !== 'listing.posted'),
      observedScopes: ['gmail.send', 'gmail.read'],
    },
    {
      ...base,
      agent: 'claude',
      allowedTypes: ALL_TYPES.filter((type) => type !== 'purchase.made'),
      counterpartyAllowlist: ['example1.com', 'example2.com'],
    },
  ].map((grant) => ({
    ...grant,
    ...(grant.agent === 'chatgpt' ? {} : { accounts: BOUND }),
    updatedAt: since,
  }));
  const muse = grants[0];
  const changed = { ...muse, spendCeilingCents: 20_000, updatedAt: isoAt(changeAtMs, 0) };
  return [...grants, changed].map((grant) => Grant.parse(grant));
}

/** Session pings, idle spans of 5–60 minutes, activity-log entries, adapter syncs every six hours per agent. */
export function makeActivity(random: Random, untilMs: number): Activity {
  const at = () => isoAt(START_MS + Math.floor(random() * SPAN_MS), 0);
  const idle = () => {
    const fromMs = START_MS + Math.floor(random() * SPAN_MS);
    return { from: isoAt(fromMs, 0), to: isoAt(fromMs + (5 + Math.floor(random() * 55)) * MS_PER_MINUTE, 0) };
  };
  const adapterSyncs = AGENTS.flatMap((agent) => {
    const syncs = [];
    for (let ms = START_MS; ms <= untilMs; ms += 6 * MS_PER_HOUR)
      syncs.push({ agent, lastSyncAt: isoAt(ms, 0) });
    return syncs;
  });
  return Activity.parse({
    sessions: Array.from({ length: 150 }, () => ({ agent: pick(random, AGENTS), at: at() })),
    idle: Array.from({ length: 60 }, idle),
    entries: Array.from({ length: 150 }, () => ({ agent: pick(random, AGENTS), at: at() })),
    adapterSyncs,
    claims: [],
  });
}

/** A policy version and the raw document it was loaded from (the export stores documents). */
export interface PolicyVersion {
  readonly policy: Policy;
  readonly document: unknown;
}

/** policy/default.json, then a revision with a lower verified threshold and receipt parsers for 20 merchants. */
export function makePolicies(): readonly [PolicyVersion, PolicyVersion] {
  const revised = {
    ...defaultPolicyJson,
    thresholds: { ...defaultPolicyJson.thresholds, verified: 0.8 },
    receiptMerchants: Array.from({ length: 20 }, (_, k) => merchant(k)),
  };
  return [
    { policy: loadPolicy(defaultPolicyJson), document: defaultPolicyJson },
    { policy: loadPolicy(revised), document: revised },
  ];
}

export interface WorldOptions {
  readonly seed: number;
  readonly claims: number;
  readonly observations: number;
  /**
   * Batch instants, at least 2: from 10 hours into the span to 6 hours after it, about evenly spaced (the last
   * batch leaves recent claims PENDING and coverage-capped ones short of `finalizeUnverifiableHours`).
   */
  readonly batches: number;
}

export interface World {
  readonly claims: readonly Claim[];
  readonly observations: readonly Observation[];
  readonly grants: readonly Grant[];
  readonly passes: readonly ObserverCoverage[];
  /** Everything attribution reads except `claims`, which each batch fills with the claims seen by then. */
  readonly activity: Activity;
  /** Strictly increasing batch instants. */
  readonly batchTimes: readonly string[];
  /** The policy of batch i: the first version for the first half of the batches, then the second. */
  readonly policyAt: (batch: number) => PolicyVersion;
  readonly policies: readonly PolicyVersion[];
}

function batchInstants(random: Random, count: number): number[] {
  const firstMs = START_MS + 10 * MS_PER_HOUR;
  const stepMs = Math.floor((SPAN_MS - 4 * MS_PER_HOUR) / Math.max(1, count - 1));
  return Array.from(
    { length: count },
    (_, i) => firstMs + i * stepMs + Math.floor(random() * 30 * MS_PER_MINUTE),
  );
}

/** The seeded world (see the file comment). */
export function syntheticWorld(options: WorldOptions): World {
  const random = seededRandom(options.seed);
  const observations = Array.from({ length: options.observations }, (_, n) => makeObservation(random, n));
  const last: { o?: Observation } = {};
  const claims = Array.from({ length: options.claims }, (_, i) =>
    makeClaim(random, i, claimFields(random, observations, last)),
  );
  const instants = batchInstants(random, Math.max(2, options.batches));
  const lastMs = instants[instants.length - 1] ?? START_MS;
  const middle = Math.floor(instants.length / 2);
  const changeAtMs = (instants[middle - 1] ?? START_MS) + MS_PER_HOUR;
  const policies = makePolicies();
  return {
    claims,
    observations,
    grants: makeGrants(changeAtMs),
    passes: makePasses(random, lastMs),
    activity: makeActivity(random, lastMs),
    batchTimes: instants.map((ms) => isoAt(ms, 0)),
    policyAt: (batch) => (batch < middle ? policies[0] : policies[1]),
    policies,
  };
}
