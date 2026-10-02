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
  unasked: z.looseObject({ threshold: z.number() }),
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

export function labelHash(label: string): string {
  return sha256Hex(label);
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

/** §10: rawHash = SHA-256 of {agent, sourceKind, rowKeyHash or null, text, claimedAt truncated}. */
export function buildClaim(claim: ScenarioClaim): Claim {
  const precision = claim.claimedAtPrecision ?? 'minute';
  const sourceKind = claim.sourceKind ?? 'activity_view';
  const rawHash = hashCanonical({
    agent: claim.agent,
    sourceKind,
    rowKeyHash: claim.rowKey === undefined ? null : labelHash(claim.rowKey),
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

/** §10: SHA-256 of {source, type, ...allowlisted content fields}, rowKeyHash included whenever present. */
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
  const rowKeyHash = observation.rowKey === undefined ? undefined : labelHash(observation.rowKey);
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
    updatedAt: shiftIso(evaluatedAt, -MS_PER_DAY),
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
    ...present(entry, ['allCalendars']),
  };
}

export function buildCoverage(entries: readonly ScenarioCoverage[], evaluatedAt: string): Coverage {
  return Coverage.parse({ evaluatedAt, observers: entries.map(coverageEntry) });
}
