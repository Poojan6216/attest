/**
 * Derived index fields: computed by the repo on write, stripped on read.
 *
 * A stored row is the strict domain object plus a few derived keys that exist only so IndexedDB can
 * answer the hot query paths (tech_reviewer: type+timeBucket, agent+date, the coverage instants). They are
 * never part of a domain object, never returned to callers, and never exported. Every derived value is
 * computed from allowlisted domain fields only, so no new content enters storage (Hard Rule 2).
 *
 * Derived values are frozen into each row when it is written. Changing how one is computed (the bucket
 * width `LEDGER_TIME_BUCKET_MINUTES`, `dateKey`) needs a ledger
 * migration whose `upgrade` recomputes the field over existing rows. Without it, old rows silently drop out
 * of the index queries, and evidence Attest already saw stops reaching grading (Hard Rule 5).
 */
import { LEDGER_TIME_BUCKET_MINUTES } from '../config';
import { LedgerError } from './errors';
import type { Claim, CoveragePing, Observation, Receipt, Request } from './types';

/**
 * Every ledger table (build_spec §6): the eight of Sprint 0, the coverage intervals of 2.6 (./coverage.ts), the
 * Calendar snapshots of 2.7 (./calendar-snapshots.ts) and the activity of 3.14 (./activity.ts). The bus `LedgerTable` enum, the export, the migrations and
 * the logger's table names list exactly these.
 */
export const LEDGER_TABLE_NAMES = [
  'requests',
  'claims',
  'observations',
  'grants',
  'receipts',
  'adapterHealth',
  'coverage',
  'meta',
  'coverageIntervals',
  'calendarSnapshots',
  'activity',
] as const;

export type LedgerTableName = (typeof LEDGER_TABLE_NAMES)[number];

/**
 * The replay records (sprint_3 3.13; docs/grading.md §9): what each receipt was graded with besides its subject and
 * candidates (`receiptInputs`, keyed by the receipt's `inputsHash`), and the policy documents receipts name
 * (`policies`, keyed by `policyHash`). Stored beside the ledger tables and written only by a grading batch, never
 * announced on the bus, and exported as the two maps `pnpm attest replay` reads (./export.ts).
 */
export const REPLAY_TABLE_NAMES = ['receiptInputs', 'policies', 'batchCoverages'] as const;

export type ReplayTableName = (typeof REPLAY_TABLE_NAMES)[number];

/** Every table the ledger database holds: the ledger tables and the replay records. */
export type StoredTableName = LedgerTableName | ReplayTableName;

/** The derived keys each table adds to its rows. Everything else in a row is the domain object. */
export const INDEX_FIELDS: Readonly<Record<StoredTableName, readonly string[]>> = {
  requests: ['date'],
  claims: ['date'],
  observations: ['timeBucket'],
  grants: [],
  // `agent` is a Receipt field (docs/grading.md §14.3), so the [agent+date] index reads it from the domain.
  receipts: ['date'],
  adapterHealth: [],
  coverage: ['accountKey'],
  meta: [],
  // Epoch ms read by core `instantMs` (./coverage.ts), so IndexedDB answers range queries by instant; the kind and
  // length keep window reads off the markers and bound them (schema v4, TECH-1).
  coverageIntervals: ['accountKey', 'startMs', 'endMs', 'syncMs', 'kind', 'lenMs'],
  // The snapshot's `readAt` in epoch ms, for the retention purge (./calendar-snapshots.ts).
  calendarSnapshots: ['readMs'],
  // The epoch ms a row's window spans (a session's instant, an idle interval's ends): range reads (./activity.ts).
  activity: ['startMs', 'endMs'],
  receiptInputs: [],
  policies: [],
  batchCoverages: [],
};

export type RequestRow = Request & { readonly date: string };
export type ClaimRow = Claim & { readonly date: string };
export type ObservationRow = Observation & {
  readonly timeBucket: number;
};
export type ReceiptRow = Receipt & { readonly date: string };
export type CoverageRow = CoveragePing & { readonly accountKey: string };

const TIME_BUCKET_MS = LEDGER_TIME_BUCKET_MINUTES * 60_000;

/**
 * `YYYY-MM-DD` of an ISO-with-offset timestamp: the writer's local date at the place it was recorded. Edge
 * stamps come from src/clock.ts nowIso() (local offset), and adapters store vendor times with the page's
 * offset, so this is the date the user saw. Never used for ordering (see epochMs).
 */
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
  };
}

export function toReceiptRow(receipt: Receipt): ReceiptRow {
  return { ...receipt, date: dateKey(receipt.computedAt) };
}

export function toCoverageRow(ping: CoveragePing): CoverageRow {
  return { ...ping, accountKey: accountKeyOf(ping.accountHash) };
}

/**
 * Removes a table's derived keys from a stored row. Input is untrusted (it came off disk), so it is
 * `unknown` in and `unknown` out: the caller Zod-parses the result with the strict domain schema.
 */
export function stripIndexFields(table: StoredTableName, row: unknown): unknown {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return row;
  const derived = INDEX_FIELDS[table];
  const kept: [string, unknown][] = Object.entries(row).filter(([key]) => !derived.includes(key));
  return Object.fromEntries(kept);
}
