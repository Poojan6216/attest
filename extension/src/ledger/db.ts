/**
 * The ledger database: the Dexie subclass, the v1 stores spec, and the row reader.
 *
 * Dexie is imported only inside src/ledger (lint fence). Tables are exposed as typed getters over
 * `this.table(...)` so no definite-assignment fields or casts are needed; Dexie leaves accessors that
 * already exist on the prototype alone.
 *
 * Rows on disk are untrusted: they may predate a schema change or have been written by a buggy build.
 * Every read goes through `readRow`, which strips derived index fields, Zod-parses with the strict domain
 * schema, and skips (and logs by id only) a row that fails. Corrupt rows never reach the UI.
 */
import { Dexie, type Table } from 'dexie';
import { z } from 'zod';

import { log } from '../log';
import {
  stripIndexFields,
  type ClaimRow,
  type CoverageRow,
  type LedgerTableName,
  type ObservationRow,
  type ReceiptRow,
  type RequestRow,
  type StoredTableName,
} from './index-fields';
import type { ActivityRow } from './activity';
import type { CalendarRecordRow } from './calendar-snapshots';
import {
  AgentId,
  Ulid,
  type AdapterHealth,
  type AlertRecord,
  type BatchCoverageRecord,
  type Grant,
  type MetaEntry,
  type ObserverCoverage,
  type PolicyRecord,
  type ReceiptInputsRecord,
  Sha256,
} from './types';

/**
 * Schema v1 (tech_reviewer index requirements). First entry of each spec is the primary key.
 *  - `&` unique: one observation per contentHash, one claim per rawHash (idempotent upserts).
 *  - `[a+b]` compound: type+timeBucket for candidate retrieval, agent+date for the daily views.
 *  - `*` multiEntry: one index entry per counterparty token.
 *  - coverage has a compound primary key `[observerId+accountKey]` (accountKey = accountHash or '').
 */
export const STORES_V1 = {
  requests: 'id, [agent+date], conversationId',
  claims: 'id, &rawHash, [agent+date], requestId, type',
  observations: 'id, &contentHash, [type+timeBucket], *counterpartyTokens, occurredAt',
  grants: 'agent',
  receipts: 'id, claimId, [agent+date], state, grade',
  adapterHealth: 'adapterId',
  coverage: '[observerId+accountKey], observerId, lastSyncAt',
  meta: 'key',
} as const satisfies Readonly<
  Record<Exclude<LedgerTableName, 'coverageIntervals' | 'calendarSnapshots' | 'activity' | 'alerts'>, string>
>;

export type CoverageKey = [observerId: string, accountKey: string];
export type CalendarKey = [observerId: string, accountHash: string, range: string];

/** The coverage interval store (./coverage.ts). */
export const COVERAGE_INTERVALS = 'coverageIntervals';

/** The Calendar snapshot store (./calendar-snapshots.ts). */
export const CALENDAR_SNAPSHOTS = 'calendarSnapshots';

/**
 * Schema v2 (Sprint 2.6, Decisions [2.6]). Only the tables that change:
 *  - receipts gain `*observationIds` (multiEntry) and `supersededBy`, so the retention purge (./retention.ts) finds
 *    the receipts that name an observation, or that a purged claim superseded (`supersededBy` holds a claim id,
 *    docs/grading.md §8), through an index, never a scan.
 *  - `coverageIntervals` holds every coverage interval an observer pass reported (core `ObserverCoverage`, docs/
 *    grading.md §3), several per source within retention, keyed by an outbound auto-increment key. Its derived
 *    fields (`accountKey`, `startMs`, `endMs`, `syncMs`: epoch ms read by core `instantMs`) answer `coverageFor` and
 *    the purge by range. It is read only through ./coverage.ts (registered in LEDGER_TABLE_NAMES by Sprint 2.7).
 */
export const STORES_V2 = {
  receipts: 'id, claimId, [agent+date], state, grade, *observationIds, supersededBy',
  [COVERAGE_INTERVALS]: '++, [source+endMs], [source+accountKey], [source+accountKey+syncMs]',
} as const;

/**
 * Schema v3 (Sprint 2.7, Decisions [2.7]): `calendarSnapshots` holds, per Calendar observer, account hash and visible
 * range, the snapshot the service worker diffs the next pass against (./calendar-snapshots.ts), keyed by
 * `[observerId+accountHash+range]`, with `readMs` (its `readAt` in epoch ms) for the retention purge. New and empty
 * on upgrade (no snapshot was stored before 2.7), so v3 needs no data upgrade.
 */
export const STORES_V3 = {
  [CALENDAR_SNAPSHOTS]: '[observerId+accountHash+range], readMs',
} as const;

/**
 * Schema v4 (Sprint 2 close; Decisions [2.close]):
 *  - `coverageIntervals` gains two derived fields and two indexes, so the coverage reads stay bounded as the calendar
 *    fills (TECH-1; ./coverage.ts, ./coverage-store.ts). `kind`: `point` for an interval over one instant (a
 *    first-look marker, a receipt's instant), `span` otherwise, so a window read never walks the markers: points and
 *    spans are read from separate index ranges. `lenMs`: `endMs - startMs`; `[source+kind+lenMs]` gives the longest
 *    span of a source in one read, so a read of the spans that may overlap a window stops at its end plus that
 *    length, exactly: no assumed maximum.
 *  - `observations` drops the v1 `*counterpartyTokens` index (TECH-13): only tests read it; candidate retrieval reads
 *    `[type+timeBucket]` and core's own tokens (./index.ts).
 * The upgrade computes `kind` and `lenMs` over every stored interval and removes `counterpartyTokens` from every
 * stored observation (./migrations.ts), so no stored row carries a field its strict read would refuse.
 */
export const STORES_V4 = {
  observations: 'id, &contentHash, [type+timeBucket], occurredAt',
  [COVERAGE_INTERVALS]:
    '++, [source+endMs], [source+accountKey], [source+accountKey+syncMs], [source+kind+endMs], [source+kind+lenMs]',
} as const;

/** The receipt inputs store (./replay-records.ts). */
export const RECEIPT_INPUTS = 'receiptInputs';

/** The policy document store (./replay-records.ts). */
export const POLICIES = 'policies';

/**
 * Schema v5 (sprint_3 3.13; Decisions [3.13]): the replay records (docs/grading.md §9, ./index-fields.ts
 * REPLAY_TABLE_NAMES). `receiptInputs` holds what each stored receipt was graded with besides its subject and
 * candidates, keyed by its `inputsHash`, with a `policyHash` index so the purge finds the documents no input names any
 * more; `policies` holds each policy document a receipt names, keyed by its `policyHash`. Both are new and empty on
 * upgrade (no batch ran before 3.13), so v5 needs no data upgrade.
 */
export const STORES_V5 = {
  [RECEIPT_INPUTS]: 'inputsHash, policyHash',
  [POLICIES]: 'policyHash',
} as const;

/** The activity store (./activity.ts). */
export const ACTIVITY = 'activity';

/**
 * Schema v6 (sprint_3 3.14; Decisions [3.14]): `activity` holds the session pings of pasted logs and the idle
 * intervals Chrome reported (opt-in), keyed by `id`, with `endMs` indexed so the grading batch reads its horizon and the
 * purge its cutoff by range. New and empty on upgrade, so v6 needs no data upgrade.
 */
export const STORES_V6 = {
  [ACTIVITY]: 'id, endMs',
} as const;

/** The batch coverage store (./replay-records.ts). */
export const BATCH_COVERAGES = 'batchCoverages';

/**
 * Schema v7 (Sprint 3 close; tech review TECH-1): `batchCoverages` holds each batch's coverage once, keyed by its
 * `coverageHash`, and each `receiptInputs` row names its coverage by that hash, indexed so a coverage no row names any
 * more is released. v5 kept a copy in every row, and every receipt of a batch was graded with the same coverage: at 200
 * Calendar markers a copy was 62 KB, rewritten for every PENDING receipt by every batch. The upgrade moves each stored
 * copy into the new store (./migrations.ts).
 */
export const STORES_V7 = {
  [RECEIPT_INPUTS]: 'inputsHash, policyHash, coverageHash',
  [BATCH_COVERAGES]: 'coverageHash',
} as const;

/**
 * Schema v8 (sprint_4 4.0; Decisions [4.0]): receipts gain `[agent+computedMs]` and `[agent+grade+computedMs]`
 * (`computedMs`: `computedAt` in epoch ms, a derived index field), so the popup and the side panel's timeline read the
 * newest receipts of a range, of every grade or of the grades a filter asks, a page at a time, through an index, in the
 * order they show them (./views.ts). `[agent+date]` gives a day's receipts in id order, and an id is a hash, so showing
 * a day newest first meant reading all of it; and a filter for a rare grade would read every receipt of the range. The
 * upgrade derives `computedMs` over every stored receipt (./migrations.ts).
 */
export const STORES_V8 = {
  receipts:
    'id, claimId, [agent+date], state, grade, *observationIds, supersededBy, [agent+computedMs], [agent+grade+computedMs]',
} as const;

/** The alerts store (./alerts.ts). */
export const ALERTS = 'alerts';

/**
 * Schema v9 (sprint_4 4.6; Decisions [4.6]): `alerts` holds one row per receipt that alerts, keyed by the receipt's id,
 * with `state` indexed so the service worker reads only the pending ones. New and empty on upgrade: no receipt alerted
 * before 4.6, and none made FINAL before is alerted later.
 */
export const STORES_V9 = {
  [ALERTS]: 'receiptId, state',
} as const;

/** What one stored interval covers: one instant (`windowStart = windowEnd`) or a span of time. */
export type IntervalKind = 'point' | 'span';

/** A stored coverage interval: the core `ObserverCoverage` plus the derived fields ./coverage.ts strips on read. */
export type CoverageIntervalRow = ObserverCoverage & {
  readonly accountKey: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly syncMs: number;
  readonly kind: IntervalKind;
  readonly lenMs: number;
};

/** Developer-chosen keys (adapter ids, observer ids, meta keys); the logger prints one only if it is in LOG_VALUES. */
const PLAIN_KEY = z.string().min(1);

/**
 * The field that identifies a row in ledger logs (the primary key, or its first part) and the schema its
 * value must pass to be logged. A corrupt row's id field can hold anything, content included, so a value
 * that is not a well-formed id is logged as `null`, never echoed (Hard Rule 10).
 */
const ROW_ID: Readonly<Record<StoredTableName, { readonly field: string; readonly schema: z.ZodType }>> = {
  requests: { field: 'id', schema: Ulid },
  claims: { field: 'id', schema: Ulid },
  observations: { field: 'id', schema: Ulid },
  grants: { field: 'agent', schema: AgentId },
  receipts: { field: 'id', schema: Ulid },
  adapterHealth: { field: 'adapterId', schema: PLAIN_KEY },
  coverage: { field: 'observerId', schema: PLAIN_KEY },
  meta: { field: 'key', schema: PLAIN_KEY },
  // Outbound auto-increment key: the observer names the row in logs.
  coverageIntervals: { field: 'observerId', schema: PLAIN_KEY },
  calendarSnapshots: { field: 'observerId', schema: PLAIN_KEY },
  activity: { field: 'id', schema: Sha256 },
  receiptInputs: { field: 'inputsHash', schema: Sha256 },
  policies: { field: 'policyHash', schema: Sha256 },
  batchCoverages: { field: 'coverageHash', schema: Sha256 },
  alerts: { field: 'receiptId', schema: Ulid },
};

export class LedgerDb extends Dexie {
  get requests(): Table<RequestRow, string> {
    return this.table<RequestRow, string>('requests');
  }

  get claims(): Table<ClaimRow, string> {
    return this.table<ClaimRow, string>('claims');
  }

  get observations(): Table<ObservationRow, string> {
    return this.table<ObservationRow, string>('observations');
  }

  get grants(): Table<Grant, AgentId> {
    return this.table<Grant, AgentId>('grants');
  }

  get receipts(): Table<ReceiptRow, string> {
    return this.table<ReceiptRow, string>('receipts');
  }

  get adapterHealth(): Table<AdapterHealth, string> {
    return this.table<AdapterHealth, string>('adapterHealth');
  }

  get coverage(): Table<CoverageRow, CoverageKey> {
    return this.table<CoverageRow, CoverageKey>('coverage');
  }

  get meta(): Table<MetaEntry, string> {
    return this.table<MetaEntry, string>('meta');
  }

  /** Schema v2. Read and written only through ./coverage.ts. */
  get coverageIntervals(): Table<CoverageIntervalRow, number> {
    return this.table<CoverageIntervalRow, number>(COVERAGE_INTERVALS);
  }

  /** Schema v3. Read and written only through ./calendar-snapshots.ts. */
  get calendarSnapshots(): Table<CalendarRecordRow, CalendarKey> {
    return this.table<CalendarRecordRow, CalendarKey>(CALENDAR_SNAPSHOTS);
  }

  /** Schema v6. Read and written only through ./activity.ts. */
  get activity(): Table<ActivityRow, string> {
    return this.table<ActivityRow, string>(ACTIVITY);
  }

  /** Schema v5. Read and written only through ./replay-records.ts. */
  get receiptInputs(): Table<ReceiptInputsRecord, string> {
    return this.table<ReceiptInputsRecord, string>(RECEIPT_INPUTS);
  }

  /** Schema v5. Read and written only through ./replay-records.ts. */
  get policies(): Table<PolicyRecord, string> {
    return this.table<PolicyRecord, string>(POLICIES);
  }

  /** Schema v7. Read and written only through ./replay-records.ts. */
  get batchCoverages(): Table<BatchCoverageRecord, string> {
    return this.table<BatchCoverageRecord, string>(BATCH_COVERAGES);
  }

  /** Schema v9. Read and written only through ./alerts.ts. */
  get alerts(): Table<AlertRecord, string> {
    return this.table<AlertRecord, string>(ALERTS);
  }
}

/**
 * The table name as the logger prints it: snake_case, the form listed in the logger's vocabulary
 * (src/log-vocabulary.ts), so `adapterHealth` logs as `adapter_health`.
 */
export function logTableId(table: StoredTableName): string {
  return table.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** A well-formed id for the table's log lines, or `null` when the value is not one. */
export function loggableId(table: StoredTableName, value: unknown): string | null {
  const { schema } = ROW_ID[table];
  return typeof value === 'string' && schema.safeParse(value).success ? value : null;
}

function rowId(table: StoredTableName, row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null;
  return loggableId(table, Reflect.get(row, ROW_ID[table].field));
}

/**
 * Stored row → strict domain object, or `undefined` when there is no row or the row is invalid.
 * An invalid row is logged as `ledger.row_invalid` with its table and id only (never its content).
 */
export function readRow<S extends z.ZodType>(
  table: StoredTableName,
  schema: S,
  row: unknown,
): z.output<S> | undefined {
  if (row === undefined) return undefined;
  const parsed = schema.safeParse(stripIndexFields(table, row));
  if (parsed.success) return parsed.data;
  log.warn('ledger.row_invalid', {
    table: logTableId(table),
    id: rowId(table, row),
    issues: parsed.error.issues.length,
  });
  return undefined;
}

/** Many rows → the valid domain objects among them, in the same order. */
export function readRows<S extends z.ZodType>(
  table: StoredTableName,
  schema: S,
  rows: readonly unknown[],
): z.output<S>[] {
  const out: z.output<S>[] = [];
  for (const row of rows) {
    const value = readRow(table, schema, row);
    if (value !== undefined) out.push(value);
  }
  return out;
}
