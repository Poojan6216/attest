/**
 * Records every read Dexie asks IndexedDB for (sprint_4 4.0 done-when: "every query hits an index"): a DBCore
 * middleware between Dexie and IndexedDB sees each request, with its table, the index it goes through (null for the
 * primary key) and its range, and counts the rows each table delivers. A range of the whole index
 * (`DBCoreRangeType.Any`) is a full scan of the table, whatever the index. Reads by key (`get`, `getMany`) never are.
 */
import type {
  DBCore,
  DBCoreCountRequest,
  DBCoreCursor,
  DBCoreOpenCursorRequest,
  DBCoreQueryRequest,
  DBCoreTable,
} from 'dexie';

import type { LedgerDb } from '../../../src/ledger/db';

export interface RecordedRead {
  readonly table: string;
  readonly op: 'get' | 'getMany' | 'query' | 'openCursor' | 'count';
  /** The index read through; null for the primary key. */
  readonly index: string | null;
  /** Whether the read spans the whole index: a full scan of the table. */
  readonly whole: boolean;
}

export interface Recorder {
  /** Every read request, oldest first. */
  readonly reads: RecordedRead[];
  /** The rows each table delivered: every row a cursor stepped onto, a query returned or a key found. */
  readonly rows: Map<string, number>;
}

/** `DBCoreRangeType.Any`: an ambient const enum in Dexie's types, which isolated modules cannot read, so it is written here. */
const ANY_RANGE = 3;

type RangedRequest = DBCoreQueryRequest | DBCoreOpenCursorRequest | DBCoreCountRequest;

function ranged(table: string, op: RecordedRead['op'], request: RangedRequest): RecordedRead {
  const { index, range } = request.query;
  const rangeType: number = range.type;
  return {
    table,
    op,
    index: index.isPrimaryKey === true ? null : index.name,
    whole: rangeType === ANY_RANGE,
  };
}

/**
 * `cursor`, counting each row it steps onto. Its key, primary key and value are read through to the cursor itself, as
 * Dexie's own middlewares wrap a cursor: a browser's IDBCursor getters refuse any other `this`.
 */
function counting(cursor: DBCoreCursor, step: () => void): DBCoreCursor {
  const counted: DBCoreCursor = Object.create(cursor, {
    key: { get: (): unknown => cursor.key },
    primaryKey: { get: (): unknown => cursor.primaryKey },
    value: { get: (): unknown => cursor.value },
    start: {
      value: (onNext: () => void) =>
        cursor.start(() => {
          step();
          onNext();
        }),
    },
  }) as DBCoreCursor;
  return counted;
}

function recording(down: DBCoreTable, recorder: Recorder): DBCoreTable {
  const { name } = down;
  const add = (rows: number) => recorder.rows.set(name, (recorder.rows.get(name) ?? 0) + rows);
  return {
    ...down,
    get: (request) => {
      recorder.reads.push({ table: name, op: 'get', index: null, whole: false });
      return down.get(request).then((value: unknown) => {
        if (value !== undefined) add(1);
        return value;
      });
    },
    getMany: (request) => {
      recorder.reads.push({ table: name, op: 'getMany', index: null, whole: false });
      return down.getMany(request).then((values: unknown[]) => {
        add(values.filter((value) => value !== undefined).length);
        return values;
      });
    },
    query: (request) => {
      recorder.reads.push(ranged(name, 'query', request));
      return down.query(request).then((response) => {
        add(response.result.length);
        return response;
      });
    },
    openCursor: (request) => {
      recorder.reads.push(ranged(name, 'openCursor', request));
      return down
        .openCursor(request)
        .then((cursor) => (cursor === null ? null : counting(cursor, () => add(1))));
    },
    count: (request) => {
      recorder.reads.push(ranged(name, 'count', request));
      return down.count(request);
    },
  };
}

/**
 * Reopens `db` with the recorder in place (Dexie builds its middleware stack when a database opens) and returns it,
 * empty: it records from now on.
 */
export async function recordReads(db: LedgerDb): Promise<Recorder> {
  const recorder: Recorder = { reads: [], rows: new Map() };
  db.close();
  db.use({
    stack: 'dbcore',
    name: 'read-recorder',
    create: (down: DBCore): DBCore => ({ ...down, table: (table) => recording(down.table(table), recorder) }),
  });
  await db.open();
  return recorder;
}

/** Forgets every read recorded so far: what follows is counted alone. */
export function resetRecorder(recorder: Recorder): void {
  recorder.reads.length = 0;
  recorder.rows.clear();
}

/**
 * The tables Attest keeps one row per observer and account, adapter or agent: small by construction, so reading one
 * whole is no scan of a growing table.
 */
export const SMALL_TABLES: ReadonlySet<string> = new Set(['coverage', 'adapterHealth', 'grants']);

/** The reads among `reads` that scan a whole table other than the small ones. */
export const fullScans = (reads: readonly RecordedRead[]): RecordedRead[] =>
  reads.filter((read) => read.whole && !SMALL_TABLES.has(read.table));
