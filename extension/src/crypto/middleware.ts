/**
 * Sealing the ledger's rows at rest (sprint_6 6.5): a Dexie DBCore middleware on the ledger's own database. In each
 * table of SEALED_TABLES, a row is written as its plain part, the fields IndexedDB keys and indexes it by (the primary
 * key, every index's key path) and the ledger's derived index fields, and `sealed`, every other field sealed together
 * under the current key with the table and the row's key as additional data (./seal.ts). A row read is opened again,
 * whole, before anything above it sees it; a plain row (written while encryption was off, or not yet reached by the job
 * that turns it on) passes as it is.
 *
 * Fail closed, never partly (Hard Rule 5; the sprint's "zero partial reads"): while the ledger is locked (it may hold
 * sealed rows, and no key is held here) every read and write of a sealed table fails with `locked`, a count or a key
 * alone included, whether or not the rows it would reach are sealed; a sealed row whose key this context does not
 * hold fails the whole read with `locked` too (the key before a passphrase change, once forgotten), and one that does
 * not open with its key (a changed byte, a row moved) fails it with `unreadable`. So nothing is read in part, and
 * nothing is written in the clear by accident. Ids, hashes, dates, instants and codes the indexes read stay in the clear,
 * as docs/privacy-architecture.md states. The middleware sits above Dexie's own (level 10), so they see rows as stored.
 */
import type {
  DBCore,
  DBCoreCursor,
  DBCoreMutateRequest,
  DBCoreTable,
  DBCoreTableSchema,
  Middleware,
} from 'dexie';

import { SEALED_TABLES } from '../config-crypto';
import { isLocked, keyring, keyWithId } from './keyring';
import { isSealed, open, seal } from './seal';

export interface SealingOptions {
  /** The ledger's derived index fields of `table`, which stay in the clear beside its index key paths. */
  readonly derivedFields: (table: string) => readonly string[];
  /** The error a read or write meets while the ledger is locked. */
  readonly locked: (table: string) => Error;
  /** The error a sealed row meets that does not open with its own key. */
  readonly unreadable: (table: string) => Error;
}

const SEALED = new Set(SEALED_TABLES);

/** The top-level fields `schema` keys and indexes `table` by, and its derived fields: the plain part of a row. */
function plainFields(schema: DBCoreTableSchema, derived: readonly string[]): ReadonlySet<string> {
  const fields = new Set<string>(derived);
  for (const index of [schema.primaryKey, ...schema.indexes]) {
    const paths = Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath];
    for (const path of paths) if (typeof path === 'string') fields.add(path.split('.')[0] ?? path);
  }
  return fields;
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What sealing and opening one table's rows needs. */
interface TableCodec {
  readonly name: string;
  readonly plain: ReadonlySet<string>;
  readonly aadOf: (row: Row) => string;
  readonly options: SealingOptions;
}

function tableCodec(table: DBCoreTable, options: SealingOptions): TableCodec {
  const name = table.name;
  const extractKey = table.schema.primaryKey.extractKey;
  return {
    name,
    plain: plainFields(table.schema, options.derivedFields(name)),
    aadOf: (row) => `${name}:${JSON.stringify(extractKey?.(row) ?? null)}`,
    options,
  };
}

/** A row as stored: unchanged while sealing is off or already sealed, else its plain part and `sealed`. */
function sealRow(codec: TableCodec, value: unknown): unknown {
  const ring = keyring();
  if (!ring.sealing || !isRow(value) || isSealed(value.sealed)) return value;
  const key = ring.current;
  if (key === undefined) throw codec.options.locked(codec.name);
  const kept: Row = {};
  const hidden: Row = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (codec.plain.has(field)) kept[field] = fieldValue;
    else hidden[field] = fieldValue;
  }
  return { ...kept, sealed: seal(key, codec.aadOf(value), hidden) };
}

/** A row as read: whole again, or the read fails (`locked` without its key, `unreadable` when it does not open). */
function openRow(codec: TableCodec, value: unknown): unknown {
  if (!isRow(value) || !isSealed(value.sealed)) return value;
  const { sealed, ...kept } = value;
  const key = keyWithId(sealed.k);
  if (key === undefined) throw codec.options.locked(codec.name);
  let hidden: unknown;
  try {
    hidden = open(key, codec.aadOf(kept), sealed);
  } catch {
    throw codec.options.unreadable(codec.name);
  }
  if (!isRow(hidden)) throw codec.options.unreadable(codec.name);
  return { ...kept, ...hidden };
}

/**
 * `cursor` with its value opened, as Dexie's own middlewares wrap a cursor: every member the cursor has is reached
 * through it, and `key`, `primaryKey` and `value` are read from the cursor itself. A browser's IDBCursor reads those
 * three through getters that refuse any other object, so the wrapper must never leave them to its prototype.
 */
const openingCursor = (codec: TableCodec, cursor: DBCoreCursor): DBCoreCursor =>
  Object.create(cursor, {
    key: { get: (): unknown => cursor.key },
    primaryKey: { get: (): unknown => cursor.primaryKey },
    value: { get: () => openRow(codec, cursor.value) },
  }) as DBCoreCursor;

function sealingTable(table: DBCoreTable, options: SealingOptions): DBCoreTable {
  const codec = tableCodec(table, options);
  const opened = (value: unknown) => openRow(codec, value);
  // Locked, a content table refuses every read and write, a count or a key alone included: zero partial reads. Each
  // method returns the promise of the layer below, chained, as Dexie's own middlewares do: never an `async` function,
  // whose native promise would leave the transaction Dexie tracks through its own.
  const refused = () => Promise.reject(options.locked(codec.name));
  return {
    ...table,
    mutate: (req: DBCoreMutateRequest) => {
      if (isLocked()) return refused();
      if (req.type !== 'add' && req.type !== 'put') return table.mutate(req);
      let values: unknown[];
      try {
        values = req.values.map((value) => sealRow(codec, value));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : options.locked(codec.name));
      }
      return table.mutate({ ...req, values });
    },
    get: (req) => (isLocked() ? refused() : table.get(req).then(opened)),
    getMany: (req) => (isLocked() ? refused() : table.getMany(req).then((rows) => rows.map(opened))),
    query: (req) =>
      isLocked()
        ? refused()
        : table
            .query(req)
            .then((response) =>
              req.values ? { ...response, result: response.result.map(opened) } : response,
            ),
    openCursor: (req) =>
      isLocked()
        ? refused()
        : table
            .openCursor(req)
            .then((cursor) =>
              cursor === null || req.values === false ? cursor : openingCursor(codec, cursor),
            ),
    count: (req) => (isLocked() ? refused() : table.count(req)),
  };
}

/** The middleware the ledger's database uses (header). */
export function sealingMiddleware(options: SealingOptions): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'AttestSealing',
    create: (down) => ({
      ...down,
      table: (name) => {
        const table = down.table(name);
        return SEALED.has(name) ? sealingTable(table, options) : table;
      },
    }),
  };
}
