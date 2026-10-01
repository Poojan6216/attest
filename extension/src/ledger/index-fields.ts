/**
 * Derived index fields: computed by the repo on write, stripped on read.
 *
 * A stored row is the strict domain object plus a few derived keys that exist only so IndexedDB can
 * answer the hot query paths (tech_reviewer: type+timeBucket, counterparty token, agent+date). They are
 * never part of a domain object, never returned to callers, and never exported. Every derived value is
 * computed from allowlisted domain fields only, so no new content enters storage (Hard Rule 2).
 *
 * Derived values are frozen into each row when it is written. Changing how one is computed (the bucket
 * width `LEDGER_TIME_BUCKET_MINUTES`, `normalizeToken`, `counterpartyTokensOf`, `dateKey`) needs a ledger
 * migration whose `upgrade` recomputes the field over existing rows. Without it, old rows silently drop out
 * of the index queries, and evidence Attest already saw stops reaching grading (Hard Rule 5).
 */
import { LEDGER_TIME_BUCKET_MINUTES } from '../config';
import { LedgerError } from './errors';
import type { AgentId, Claim, CoveragePing, Observation, Receipt, Request } from './types';

export const LEDGER_TABLE_NAMES = [
  'requests',
  'claims',
  'observations',
  'grants',
  'receipts',
  'adapterHealth',
  'coverage',
  'meta',
] as const;

export type LedgerTableName = (typeof LEDGER_TABLE_NAMES)[number];

/** The derived keys each table adds to its rows. Everything else in a row is the domain object. */
export const INDEX_FIELDS: Readonly<Record<LedgerTableName, readonly string[]>> = {
  requests: ['date'],
  claims: ['date'],
  observations: ['timeBucket', 'counterpartyTokens'],
  grants: [],
  receipts: ['agent', 'date'],
  adapterHealth: [],
  coverage: ['accountKey'],
  meta: [],
};

export type RequestRow = Request & { readonly date: string };
export type ClaimRow = Claim & { readonly date: string };
export type ObservationRow = Observation & {
  readonly timeBucket: number;
  readonly counterpartyTokens: readonly string[];
};
export type ReceiptRow = Receipt & { readonly agent: AgentId; readonly date: string };
export type CoverageRow = CoveragePing & { readonly accountKey: string };

const TIME_BUCKET_MS = LEDGER_TIME_BUCKET_MINUTES * 60_000;
const EMAIL = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/** `YYYY-MM-DD` of an ISO-with-offset timestamp: the local date at the place it was recorded. */
export function dateKey(isoTs: string): string {
  return isoTs.slice(0, 10);
}

/** Milliseconds since the epoch; throws `invalid_input` when the timestamp does not parse. */
export function epochMs(isoTs: string): number {
  const ms = Date.parse(isoTs);
  if (!Number.isFinite(ms)) {
    throw new LedgerError('invalid_input', 'Unparseable timestamp', { length: isoTs.length });
  }
  return ms;
}

/**
 * Index bucket of an instant. Offset-independent: the same instant written with different offsets lands
 * in the same bucket. Bucket width is storage plumbing (`LEDGER_TIME_BUCKET_MINUTES`), not a policy window.
 */
export function timeBucketOf(isoTs: string): number {
  return Math.floor(epochMs(isoTs) / TIME_BUCKET_MS);
}

/** Normalises a counterparty token for indexing and for lookups (same function on both sides). */
export function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Tokens for the multiEntry `counterpartyTokens` index: the normalised counterparty, its domain when it is
 * an email address, and the normalised merchant; deduplicated, in that order.
 *
 * PLACEHOLDER derivation (Sprint 0): Sprint 1 `src/core/normalize.ts` owns counterparty normalisation and
 * replaces this function's body; the index name and its multiEntry shape stay. That replacement ships with a
 * migration that re-derives `counterpartyTokens` for stored observations (see the header).
 */
export function counterpartyTokensOf(observation: Observation): string[] {
  const tokens = new Set<string>();
  const counterparty = normalizeToken(observation.counterparty ?? '');
  if (counterparty !== '') {
    tokens.add(counterparty);
    const domain = EMAIL.exec(counterparty)?.[1];
    if (domain !== undefined) tokens.add(domain);
  }
  const merchant = normalizeToken(observation.merchant ?? '');
  if (merchant !== '') tokens.add(merchant);
  return [...tokens];
}

/** Coverage rows are keyed by `[observerId+accountKey]`; IndexedDB keys cannot be undefined. */
export function accountKeyOf(accountHash: string | undefined): string {
  return accountHash ?? '';
}

export function toRequestRow(request: Request): RequestRow {
  return { ...request, date: dateKey(request.ts) };
}

export function toClaimRow(claim: Claim): ClaimRow {
  return { ...claim, date: dateKey(claim.claimedAt) };
}

export function toObservationRow(observation: Observation): ObservationRow {
  return {
    ...observation,
    timeBucket: timeBucketOf(observation.occurredAt),
    counterpartyTokens: counterpartyTokensOf(observation),
  };
}

export function toReceiptRow(receipt: Receipt, agent: AgentId): ReceiptRow {
  return { ...receipt, agent, date: dateKey(receipt.computedAt) };
}

export function toCoverageRow(ping: CoveragePing): CoverageRow {
  return { ...ping, accountKey: accountKeyOf(ping.accountHash) };
}

/**
 * Removes a table's derived keys from a stored row. Input is untrusted (it came off disk), so it is
 * `unknown` in and `unknown` out: the caller Zod-parses the result with the strict domain schema.
 */
export function stripIndexFields(table: LedgerTableName, row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const derived = INDEX_FIELDS[table];
  const kept: [string, unknown][] = Object.entries(row).filter(([key]) => !derived.includes(key));
  return Object.fromEntries(kept);
}
