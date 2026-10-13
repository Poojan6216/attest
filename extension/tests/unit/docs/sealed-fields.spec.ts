import 'fake-indexeddb/auto';
/**
 * The privacy architecture's §12 table of the fields each sealed table keeps in the clear (Sprint 6 close, tech review
 * TECH-15) is the one the sealing middleware keeps (src/crypto/middleware.ts `plainFields`), read from the ledger's own
 * schema with its derived index fields (src/ledger/index-fields.ts INDEX_FIELDS): a new index that leaves a field in the
 * clear fails here until the doc says so, and so does a table the doc leaves out.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SEALED_TABLES } from '../../../src/config-crypto';
import { plainFields } from '../../../src/crypto/middleware';
import {
  INDEX_FIELDS,
  LEDGER_TABLE_NAMES,
  REPLAY_TABLE_NAMES,
  type StoredTableName,
} from '../../../src/ledger/index-fields';
import { openLedger } from '../../../src/ledger/migrations';
import { uniqueDbName } from '../ledger/fixtures';

const DOC = readFileSync(path.join(import.meta.dirname, '../../../../docs/privacy-architecture.md'), 'utf8');
const STORED: ReadonlySet<string> = new Set<string>([...LEDGER_TABLE_NAMES, ...REPLAY_TABLE_NAMES]);
const isStored = (name: string): name is StoredTableName => STORED.has(name);

/** The §12 table: each sealed table, and the fields it keeps in the clear, sorted. */
function documented(doc: string): Map<string, string[]> {
  const start = doc.indexOf('## 12. Encryption at rest');
  const section = doc.slice(start, doc.indexOf('\n## ', start + 1));
  const rows = new Map<string, string[]>();
  for (const [, table = '', fields = ''] of section.matchAll(/^\| `(\w+)` \| ([^|]+) \|$/gmu)) {
    rows.set(table, [...fields.matchAll(/`(\w+)`/gu)].map(([, field = '']) => field).sort());
  }
  return rows;
}

describe("§12's fields kept in the clear", () => {
  it('are, table by table, the ones the sealing middleware keeps', async () => {
    const db = await openLedger(uniqueDbName('sealed-fields'));
    try {
      const kept = new Map(
        SEALED_TABLES.map((name) => {
          const schema = db.core.schema.tables.find((table) => table.name === name);
          if (schema === undefined || !isStored(name)) throw new Error(`no schema for ${name}`);
          return [name, [...plainFields(schema, INDEX_FIELDS[name])].sort()] as const;
        }),
      );
      expect(documented(DOC)).toEqual(kept);
      // The reading fails on a changed copy of the doc.
      expect(documented(DOC.replace('`receipts` | `id`, ', '`receipts` | '))).not.toEqual(kept);
    } finally {
      db.close();
    }
  });
});
