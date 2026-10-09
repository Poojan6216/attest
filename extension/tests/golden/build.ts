/**
 * Per-object builders for the golden loader (docs/grading.md §10, §15): one scenario object in, one
 * schema-parsed core object out, with every documented default filled and every hash computed by
 * src/core/hash.ts. load.ts wires them together per scenario.
 */
import { z } from 'zod';

import { hashCanonical, idFromHash, sha256Hex } from '../../src/core/hash';
import {
  Claim,
  type ClaimInput,
  Coverage,
  Grant,
  Observation,
  type ObservationInput,
  type ObservationSource,
} from '../../src/core/schema';
import {
  ACTION_TYPES,
  type ScenarioClaim,
  type ScenarioCoverage,
  type ScenarioGrant,
  type ScenarioObservation,
} from './scenario-schema';
import { instantMs, MS_PER_DAY, shiftIso, truncateIso } from './time';

/** The few policy keys the loader and the coverage checks read; the core reads the whole file. */
export const PolicyView = z.looseObject({
  version: z.number(),
  allowlistedFields: z.record(z.string(), z.array(z.string())),
  thresholds: z.looseObject({ verified: z.number(), partial: z.number() }),
  rules: z.array(z.looseObject({ id: z.string(), then: z.string() })),
  sourcesByType: z.record(z.string(), z.array(z.string())).optional(),
  allowlistTypes: z.array(z.string()).optional(),
  receiptMerchants: z.array(z.string()).optional(),
  windows: z.looseObject({
    beforeClaimMin: z.number(),
    afterClaimMin: z.number(),
    graceMin: z.number(),
    calendarDays: z.number(),
  }),
  unasked: z.looseObject({
    threshold: z.number(),
    windows: z.looseObject({ sessionMin: z.number(), adjacentMin: z.number() }),
  }),
});
export type PolicyView = z.infer<typeof PolicyView>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** RFC 7386 JSON merge patch: objects merge, `null` deletes, everything else (arrays too) replaces. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const base = isPlainObject(target) ? target : {};
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) if (!(key in patch)) merged[key] = value;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null) merged[key] = mergePatch(base[key], value);
  }
  return merged;
}

/** §15: an `accountHash` (or `accounts` entry) label becomes the SHA-256 of the label. */
export function labelHash(label: string): string {
  return sha256Hex(label);
}

/**
 * §10 (v1.3): `rowKeyHash = sha256Hex(canonicalJson(rowKey))`, so two row keys that differ only in a lone
 * surrogate never share a hash. Claims (rawHash) and observations (contentHash) both use it.
 */
export function rowKeyHashOf(rowKey: string): string {
  return hashCanonical(rowKey);
}

/** Copy the keys of `source` that are present (exactOptionalPropertyTypes: never write `undefined`). */
function present<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): { [P in K]?: Exclude<T[P], undefined> } {
  const out: { [P in K]?: Exclude<T[P], undefined> } = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key] = value as Exclude<T[K], undefined>;
  }
  return out;
}

/**
 * §10: rawHash = SHA-256 of {agent, sourceKind, rowKeyHash or null, text, claimedAt truncated}. `claimedAtEnd`
 * (§4.1) is passed through as written and never enters rawHash.
 */
export function buildClaim(claim: ScenarioClaim): Claim {
  const precision = claim.claimedAtPrecision ?? 'minute';
  const sourceKind = claim.sourceKind ?? 'activity_view';
  const rawHash = hashCanonical({
    agent: claim.agent,
    sourceKind,
    rowKeyHash: claim.rowKey === undefined ? null : rowKeyHashOf(claim.rowKey),
    text: claim.text ?? claim.ref,
    claimedAt: truncateIso(claim.claimedAt, precision),
  });
  const input: ClaimInput = {
    id: idFromHash(rawHash),
    agent: claim.agent,
    type: claim.type,
    ...present(claim, ['counterparty', 'amountCents', 'currency', 'subjectHint', 'targetAt']),
    claimedAt: claim.claimedAt,
    claimedAtPrecision: precision,
    ...present(claim, ['claimedAtEnd']),
    observedAt: claim.observedAt ?? claim.claimedAt,
    sourceKind,
    extractor: { id: 'golden', version: '1', confidence: 1 },
    rawHash,
  };
  return Claim.parse(input);
}

const CONTENT_FIELDS = [
  'counterparty',
  'merchant',
  'amountCents',
  'currency',
  'subjectHint',
  'occurredAt',
] as const;

/**
 * §10 (v1.3): SHA-256 of {source, type, ...the content fields (counterparty, merchant, amountCents, currency,
 * subjectHint, occurredAt) that allowlistedFields[source] names and the row supplies}, plus rowKeyHash when the
 * observer has one. The derived markers (rowKeyHash, contentHash) are never content fields.
 */
export function contentHashOf(
  observation: ScenarioObservation,
  rowKeyHash: string | undefined,
  allowlisted: readonly string[],
): string {
  const fields: Record<string, unknown> = { source: observation.source, type: observation.type };
  for (const key of CONTENT_FIELDS) {
    if (allowlisted.includes(key) && observation[key] !== undefined) fields[key] = observation[key];
  }
  if (rowKeyHash !== undefined) fields.rowKeyHash = rowKeyHash;
  return hashCanonical(fields);
}

/** §15: the earliest lastSyncAt ≤ evaluatedAt among the source's entries whose window holds occurredAt. */
export function defaultObservedAt(
  observation: ScenarioObservation,
  coverage: readonly ScenarioCoverage[],
  evaluatedAt: string,
): string {
  const at = instantMs(observation.occurredAt);
  const seen = coverage
    .filter((entry) => entry.source === observation.source)
    .filter((entry) => instantMs(entry.lastSyncAt) <= instantMs(evaluatedAt))
    .filter((entry) => instantMs(entry.windowStart) <= at && at <= instantMs(entry.windowEnd))
    .sort((a, b) => instantMs(a.lastSyncAt) - instantMs(b.lastSyncAt));
  return seen[0]?.lastSyncAt ?? evaluatedAt;
}

export function buildObservation(
  observation: ScenarioObservation,
  coverage: readonly ScenarioCoverage[],
  evaluatedAt: string,
  policy: PolicyView,
): Observation {
  const rowKeyHash = observation.rowKey === undefined ? undefined : rowKeyHashOf(observation.rowKey);
  const allowlisted = policy.allowlistedFields[observation.source] ?? [];
  const contentHash = contentHashOf(observation, rowKeyHash, allowlisted);
  const input: ObservationInput = {
    id: idFromHash(contentHash),
    source: observation.source,
    type: observation.type,
    ...present(observation, ['counterparty', 'merchant', 'amountCents', 'currency', 'subjectHint']),
    occurredAt: observation.occurredAt,
    observedAt: observation.observedAt ?? defaultObservedAt(observation, coverage, evaluatedAt),
    ...(rowKeyHash === undefined ? {} : { rowKeyHash }),
    contentHash,
  };
  return Observation.parse(input);
}

function hashAccounts(
  accounts: NonNullable<ScenarioGrant['accounts']>,
): Partial<Record<ObservationSource, string[]>> {
  const out: Partial<Record<ObservationSource, string[]>> = {};
  for (const [source, labels] of Object.entries(accounts) as [ObservationSource, string[] | undefined][]) {
    if (labels !== undefined) out[source] = labels.map(labelHash);
  }
  return out;
}

export function buildGrant(grant: ScenarioGrant, evaluatedAt: string): Grant {
  return Grant.parse({
    agent: grant.agent,
    allowedTypes: grant.allowedTypes ?? [...ACTION_TYPES],
    counterpartyAllowlist: grant.counterpartyAllowlist ?? [],
    spendCeilingCents: grant.spendCeilingCents ?? null,
    ...present(grant, ['spendCurrency', 'observedScopes']),
    declaredScopes: grant.declaredScopes ?? [],
    ...(grant.accounts === undefined ? {} : { accounts: hashAccounts(grant.accounts) }),
    updatedAt: grant.updatedAt ?? shiftIso(evaluatedAt, -MS_PER_DAY),
  });
}

function coverageEntry(entry: ScenarioCoverage): Record<string, unknown> {
  return {
    observerId: entry.observerId ?? entry.source,
    source: entry.source,
    lastSyncAt: entry.lastSyncAt,
    windowStart: entry.windowStart,
    windowEnd: entry.windowEnd,
    ...(entry.accountHash === undefined ? {} : { accountHash: labelHash(entry.accountHash) }),
    ...present(entry, ['allCalendars', 'changesSince']),
  };
}

export function buildCoverage(
  entries: readonly ScenarioCoverage[],
  evaluatedAt: string,
  repairs: readonly { readonly from: string; readonly to: string }[] = [],
): Coverage {
  return Coverage.parse({
    evaluatedAt,
    observers: entries.map(coverageEntry),
    ...(repairs.length === 0 ? {} : { repairs }),
  });
}
