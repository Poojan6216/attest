/**
 * The ledger export as a file, built in the page that saves it (sprint_4 4.5; Sprint 0 close, TECH-10). Its bytes are
 * those of `JSON.stringify(exportLedger(db), null, 2)` and a newline (./export.ts: the single-message export the
 * service worker answers, kept for the test harness and `attest replay`), but no table is ever read whole. In one read
 * transaction, the snapshot `exportLedger` reads, each table is read in primary-key order a page at a time
 * (`EXPORT_PAGE_SIZE` keys, then those rows by key), each page is read as `exportLedger` reads it (strict rows, index
 * fields stripped, an invalid row skipped and logged by id, records in sorted key order), written out as JSON text and
 * handed to a Blob at once. So the page holds one page of rows at a time, and the browser keeps the rest of the file.
 */
import type { IndexableType, Table } from 'dexie';

import { EXPORT_PAGE_SIZE } from '../config';
import { CalendarRecord } from './calendar-snapshots';
import { readRows, type LedgerDb } from './db';
import {
  canonicalGrant,
  canonicalReceipt,
  type ExportOptions,
  exportInstant,
  LEDGER_EXPORT_FORMAT,
} from './export';
import { type FileWriter, fileWriter } from './file-writer';
import {
  ActivityRecord,
  AdapterHealth,
  AlertRecord,
  BatchCoverageRecord,
  DigestRecord,
  ModelAnswer,
  Claim,
  CoveragePing,
  Grant,
  MetaEntry,
  Observation,
  ObserverCoverage,
  Receipt,
  ReceiptInputsRecord,
  Request,
} from './types';
import { PolicyRecord } from './policy-record';

/** `JSON.stringify`'s indent, as the export writes it. */
const GAP = 2;
const pad = (depth: number): string => ' '.repeat(depth * GAP);

/** `value` as `JSON.stringify(value, null, 2)` writes it `depth` levels deep: each line after its first indented. */
const nested = (value: unknown, depth: number): string =>
  JSON.stringify(value, null, GAP).replaceAll('\n', `\n${pad(depth)}`);

/** A member of an object at `depth` whose value is an array (`entries` without keys) or a map, written item by item. */
interface Member {
  add(value: unknown, key?: string): void;
  close(): void;
}

function member(out: FileWriter, name: string, depth: number, brackets: '[]' | '{}'): Member {
  let count = 0;
  out.write(`${pad(depth)}${JSON.stringify(name)}: `);
  return {
    add: (value, key) => {
      out.write(count === 0 ? `${brackets.charAt(0)}\n` : ',\n');
      const label = key === undefined ? '' : `${JSON.stringify(key)}: `;
      out.write(`${pad(depth + 1)}${label}${nested(value, depth + 1)}`);
      count += 1;
    },
    close: () => {
      out.write(count === 0 ? brackets : `\n${pad(depth)}${brackets.charAt(1)}`);
    },
  };
}

/**
 * Hands `onPage` every row of `table`, a page at a time, in primary-key order: `size` keys read from where the last
 * page ended, then those rows by key. No read returns more than `size` rows.
 */
export async function eachPage<T, K extends IndexableType>(
  table: Table<T, K>,
  size: number,
  onPage: (rows: readonly T[]) => void,
): Promise<void> {
  let keys = await table.orderBy(':id').limit(size).primaryKeys();
  while (keys.length > 0) {
    const rows = await table.bulkGet(keys);
    onPage(rows.filter((row): row is T => row !== undefined));
    const last = keys.at(-1);
    if (keys.length < size || last === undefined) return;
    keys = await table.where(':id').above(last).limit(size).primaryKeys();
  }
}

/** Hands each page of one table's stored rows to `onPage` (`eachPage`). */
type Pages = (size: number, onPage: (rows: readonly unknown[]) => void) => Promise<void>;

const pagesOf =
  <T, K extends IndexableType>(table: Table<T, K>): Pages =>
  (size, onPage) =>
    eachPage(table, size, onPage);

/** One exported table: its pages, and how a page is read as `exportLedger` reads its rows. */
interface Plan {
  readonly name: string;
  readonly pages: Pages;
  readonly read: (rows: readonly unknown[]) => readonly unknown[];
}

/** The tables in the order `LedgerExport.tables` lists them. */
function tablePlans(db: LedgerDb): readonly Plan[] {
  const plan = <T, K extends IndexableType>(name: string, table: Table<T, K>, read: Plan['read']): Plan => ({
    name,
    pages: pagesOf(table),
    read,
  });
  return [
    plan('requests', db.requests, (rows) => readRows('requests', Request, rows)),
    plan('claims', db.claims, (rows) => readRows('claims', Claim, rows)),
    plan('observations', db.observations, (rows) => readRows('observations', Observation, rows)),
    plan('grants', db.grants, (rows) => readRows('grants', Grant, rows).map(canonicalGrant)),
    plan('receipts', db.receipts, (rows) => readRows('receipts', Receipt, rows).map(canonicalReceipt)),
    plan('adapterHealth', db.adapterHealth, (rows) => readRows('adapterHealth', AdapterHealth, rows)),
    plan('coverage', db.coverage, (rows) => readRows('coverage', CoveragePing, rows)),
    plan('meta', db.meta, (rows) => readRows('meta', MetaEntry, rows)),
    plan('coverageIntervals', db.coverageIntervals, (rows) =>
      readRows('coverageIntervals', ObserverCoverage, rows),
    ),
    plan('calendarSnapshots', db.calendarSnapshots, (rows) =>
      readRows('calendarSnapshots', CalendarRecord, rows),
    ),
    plan('activity', db.activity, (rows) => readRows('activity', ActivityRecord, rows)),
    plan('alerts', db.alerts, (rows) => readRows('alerts', AlertRecord, rows)),
    plan('digests', db.digests, (rows) => readRows('digests', DigestRecord, rows)),
    plan('modelAnswers', db.modelAnswers, (rows) => readRows('modelAnswers', ModelAnswer, rows)),
  ];
}

/** One replay map: its pages, and how a page is read as ./replay-records.ts reads it: each row as a key and a value. */
interface MapPlan {
  readonly name: string;
  readonly pages: Pages;
  readonly entries: (rows: readonly unknown[]) => readonly (readonly [string, unknown])[];
}

/** The replay maps in the order `LedgerExport` lists them; each table's key is the map's key (hashes, in order). */
function mapPlans(db: LedgerDb): readonly MapPlan[] {
  const plan = <T, K extends IndexableType>(
    name: string,
    table: Table<T, K>,
    entries: MapPlan['entries'],
  ): MapPlan => ({ name, pages: pagesOf(table), entries });
  return [
    plan('receiptInputs', db.receiptInputs, (rows) =>
      readRows('receiptInputs', ReceiptInputsRecord, rows).map(({ inputsHash, ...rest }) => [
        inputsHash,
        rest,
      ]),
    ),
    plan('batchCoverages', db.batchCoverages, (rows) =>
      readRows('batchCoverages', BatchCoverageRecord, rows).map(({ coverageHash, coverage }) => [
        coverageHash,
        coverage,
      ]),
    ),
    plan('policies', db.policies, (rows) =>
      readRows('policies', PolicyRecord, rows).map(({ policyHash, document }) => [policyHash, document]),
    ),
  ];
}

/** The whole ledger as the export file (header), in pages of `pageSize` rows. */
export async function exportLedgerBlob(
  db: LedgerDb,
  options: ExportOptions,
  pageSize: number = EXPORT_PAGE_SIZE,
): Promise<Blob> {
  const exportedAt = exportInstant(options);
  const out = fileWriter();
  await db.transaction('r', db.tables, async () => {
    out.write(`{\n${pad(1)}"format": ${JSON.stringify(LEDGER_EXPORT_FORMAT)},\n`);
    out.write(`${pad(1)}"schemaVersion": ${JSON.stringify(db.verno)},\n`);
    out.write(`${pad(1)}"exportedAt": ${JSON.stringify(exportedAt)},\n${pad(1)}"tables": {\n`);
    for (const [index, { name, pages, read }] of tablePlans(db).entries()) {
      if (index > 0) out.write(',\n');
      const rows = member(out, name, 2, '[]');
      await pages(pageSize, (page) => {
        for (const row of read(page)) rows.add(row);
        out.flush();
      });
      rows.close();
    }
    out.write(`\n${pad(1)}}`);
    for (const { name, pages, entries } of mapPlans(db)) {
      out.write(',\n');
      const map = member(out, name, 1, '{}');
      await pages(pageSize, (page) => {
        for (const [key, value] of entries(page)) map.add(value, key);
        out.flush();
      });
      map.close();
    }
    out.write('\n}\n');
  });
  return out.done('application/json');
}
