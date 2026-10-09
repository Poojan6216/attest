/**
 * docs/privacy-architecture.md lists every ledger table and every field it stores (sprint_2 2.9;
 * agents/privacy_reviewer.md "lists every table, every field, its allowlist source, and its retention"; Hard Rule 2).
 * The field lists come from the strict schemas the ledger writes and reads with, and the derived index fields from
 * src/ledger/index-fields.ts, so a table or a field added to the ledger without a word in the doc fails here. Each
 * check is also run on a broken copy of the doc to prove it can fail.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { splitBlocks } from '../../../../scripts/check-docs-blocks';
import { segments } from '../../../../scripts/check-docs-markdown';
import { CalendarRecord, PendingAbsence, UpdateWindow } from '../../../src/ledger/calendar-snapshots';
import {
  INDEX_FIELDS,
  LEDGER_TABLE_NAMES,
  REPLAY_TABLE_NAMES,
  type StoredTableName,
} from '../../../src/ledger/index-fields';
import { META_KEYS } from '../../../src/ledger/meta-keys';
import {
  ActivityRecord,
  AdapterHealth,
  Attribution,
  AlertRecord,
  BatchCoverageRecord,
  Claim,
  Coverage,
  CoveragePing,
  GradeContext,
  Grant,
  MetaEntry,
  Observation,
  ObserverCoverage,
  PolicyRecord,
  Reason,
  Receipt,
  ReceiptInputsRecord,
  ReceiptOverride,
  Request,
} from '../../../src/ledger/types';
import {
  SnapshotCalendar,
  SnapshotDay,
  StoredEvent,
  StoredSnapshot,
} from '../../../src/observers/gcal/snapshot';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const DOC = readFileSync(path.join(REPO_ROOT, 'docs', 'privacy-architecture.md'), 'utf8');

const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;

const keys = (schema: { readonly shape: object }): string[] => Object.keys(schema.shape);

/** Every field a table's rows hold: the schema's keys (nested ones too), then its derived index fields. */
const TABLE_FIELDS: Readonly<Record<StoredTableName, readonly string[]>> = {
  requests: keys(Request),
  claims: [...keys(Claim), ...keys(Claim.shape.extractor)],
  observations: keys(Observation),
  grants: keys(Grant),
  receipts: [...keys(Receipt), ...keys(Reason), ...keys(ReceiptOverride)],
  adapterHealth: keys(AdapterHealth),
  coverage: keys(CoveragePing),
  meta: keys(MetaEntry),
  coverageIntervals: keys(ObserverCoverage),
  calendarSnapshots: [
    ...keys(CalendarRecord),
    ...keys(StoredSnapshot),
    ...keys(SnapshotDay),
    ...keys(SnapshotCalendar),
    ...keys(StoredEvent),
    ...keys(PendingAbsence),
    ...keys(UpdateWindow),
  ],
  activity: [...new Set(ActivityRecord.options.flatMap((option) => keys(option)))],
  receiptInputs: [
    ...keys(ReceiptInputsRecord),
    ...keys(Grant),
    ...keys(GradeContext),
    ...keys(Attribution),
    ...keys(GradeContext.shape.scope.unwrap()),
  ],
  policies: keys(PolicyRecord),
  batchCoverages: [...keys(BatchCoverageRecord), ...keys(Coverage), ...keys(ObserverCoverage)],
  alerts: keys(AlertRecord),
};

/** Every table the ledger database holds: the ledger tables and the replay records (sprint_3 3.13). */
const STORED_TABLES: readonly StoredTableName[] = [...LEDGER_TABLE_NAMES, ...REPLAY_TABLE_NAMES];

/**
 * The inline code spans of the section whose heading's only code span is `table`, up to the next heading of the same
 * or a higher level; null when no such heading exists. Code blocks and HTML comments are not read.
 */
function sectionSpans(doc: string, table: string): Set<string> | null {
  let level = 0;
  let spans: Set<string> | null = null;
  for (const line of splitBlocks(doc).prose) {
    const heading = ATX.exec(line.text);
    if (heading !== null) {
      const depth = (heading[1] ?? '').length;
      if (spans !== null && depth <= level) return spans;
      const code = segments(heading[2] ?? '').filter((part) => part.code);
      if (spans === null && code.length === 1 && code[0]?.text === table) {
        level = depth;
        spans = new Set();
      }
      continue;
    }
    if (spans === null) continue;
    for (const part of segments(line.text)) if (part.code) spans.add(part.text);
  }
  return spans;
}

/** Every table without a section, and every field its section does not name. */
function problemsIn(doc: string): string[] {
  const problems: string[] = [];
  for (const table of STORED_TABLES) {
    const spans = sectionSpans(doc, table);
    if (spans === null) {
      problems.push(`${table}: no section headed \`${table}\``);
      continue;
    }
    const fields = [...TABLE_FIELDS[table], ...INDEX_FIELDS[table]];
    for (const field of new Set(fields)) {
      if (!spans.has(field)) problems.push(`${table}: field \`${field}\` is not named in its section`);
    }
  }
  return problems;
}

describe('docs/privacy-architecture.md lists every ledger table and field', () => {
  it('has a section per ledger table naming every stored field and every derived index field', () => {
    expect(problemsIn(DOC)).toEqual([]);
  });

  it('lists exactly the tables of the ledger', () => {
    expect(Object.keys(TABLE_FIELDS).sort()).toEqual([...STORED_TABLES].sort());
  });

  it('fails on a missing table section, and on a field its section does not name', () => {
    expect(DOC.split('### 5.6 `meta`')).toHaveLength(2);
    expect(problemsIn(DOC.replace('### 5.6 `meta`', '### 5.6 Meta'))).toEqual([
      'meta: no section headed `meta`',
    ]);
    expect(DOC.split('| `userActive` |')).toHaveLength(2);
    expect(problemsIn(DOC.replace('| `userActive` |', '| user activity |'))).toEqual([
      'coverage: field `userActive` is not named in its section',
    ]);
  });

  it('reads a field named in a code block or another table section as not named', () => {
    const fenced = DOC.replace('| `userActive` |', '```\n`userActive`\n```\n| user activity |');
    expect(problemsIn(fenced)).toEqual(['coverage: field `userActive` is not named in its section']);
  });
});

describe('§5.6 names every meta key the ledger writes (tech review TECH-4)', () => {
  it('names each key src/ledger/meta-keys.ts lists, and each family of keys by its prefix', () => {
    const start = DOC.indexOf('### 5.6 `meta`');
    const section = DOC.slice(start, DOC.indexOf('\n### ', start + 1));
    expect(start).toBeGreaterThanOrEqual(0);
    for (const key of META_KEYS) expect(section, key).toContain(`\`${key}`);
  });
});
