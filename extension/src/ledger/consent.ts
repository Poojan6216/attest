/**
 * The person's choices about what Attest may read or open (sprint_4 4.5, 4.9; sprint_4 close, security review SEC-3):
 * which page readers are off, and the feature flags they set. They are kept in ledger meta, which only the extension's
 * own pages and service worker can open. A content script runs in the vendor page's origin and cannot reach the
 * extension's IndexedDB, so no script on a vendor page can turn a reader back on or Check Gmail for me on.
 * `chrome.storage.local`, where 4.5 and 4.9 kept them, is open to content scripts on every Chrome Attest supports.
 *
 * One meta key each:
 *  - `readerOff.<reader>`: `true` while the person has that reader off; absent while it is on (every reader is on until
 *    turned off);
 *  - `flag.<flag>`: `true` or `false`, for each flag in SETTABLE_FLAGS, absent until the person sets it. Every other
 *    flag is read as its default, whatever is stored, until its feature ships and joins SETTABLE_FLAGS.
 * A stored value that is not `true` or `false` reads as the choice that reads and opens less: that reader off, that flag
 * off (logged by key, `ledger.row_invalid`): a choice that cannot be read is never taken as consent. Pages read them
 * here; only the service worker writes them (`reader.toggle`, `flag.set`; src/background/readers.ts, flags.ts).
 */
import { z } from 'zod';

import {
  FEATURE_FLAG_DEFAULTS,
  type FeatureFlag,
  type ReaderId,
  READERS,
  type SettableFlag,
  SETTABLE_FLAGS,
} from '../config';
import { readRow, type LedgerDb } from './db';
import { parseWrite } from './errors';

/** The meta key prefixes of the choices (./meta-keys.ts). */
export const READER_OFF_PREFIX = 'readerOff.';
export const FLAG_PREFIX = 'flag.';

export const readerOffKey = (reader: ReaderId): string => `${READER_OFF_PREFIX}${reader}`;
export const flagKey = (flag: SettableFlag): string => `${FLAG_PREFIX}${flag}`;

/** A stored choice: a key of one of the two families, and true or false. */
const Choice = z.strictObject({ key: z.string(), value: z.boolean() });
const REFUSED = 'Invalid choice';
const META = { table: 'meta' };

export type Flags = Readonly<Record<FeatureFlag, boolean>>;

/**
 * The stored values of `keys`, in order: true or false as stored, undefined when absent, and null when what is stored
 * is not a boolean (logged by key).
 */
async function storedChoices(db: LedgerDb, keys: readonly string[]): Promise<(boolean | null | undefined)[]> {
  const rows = await db.meta.bulkGet([...keys]);
  return rows.map((row) => (row === undefined ? undefined : (readRow('meta', Choice, row)?.value ?? null)));
}

/** The readers that are off (header): none when nothing is stored, and each whose stored value cannot be read. */
export async function readersOff(db: LedgerDb): Promise<ReadonlySet<ReaderId>> {
  const stored = await storedChoices(db, READERS.map(readerOffKey));
  return new Set(READERS.filter((_, index) => stored[index] !== undefined && stored[index] !== false));
}

/** Every flag (header): each settable one as the person set it, off when what is stored cannot be read; the rest as default. */
export async function readFlags(db: LedgerDb): Promise<Flags> {
  const stored = await storedChoices(db, SETTABLE_FLAGS.map(flagKey));
  const set = Object.fromEntries(
    SETTABLE_FLAGS.flatMap((flag, index) => {
      const value = stored[index];
      return value === undefined ? [] : [[flag, value === true]];
    }),
  );
  return Object.freeze({ ...FEATURE_FLAG_DEFAULTS, ...set });
}

/** Turns `reader` off or on: the key is written while it is off and removed when it is on. */
export async function saveReaderOff(db: LedgerDb, reader: ReaderId, off: boolean): Promise<void> {
  if (off) await db.meta.put(parseWrite(Choice, { key: readerOffKey(reader), value: true }, REFUSED, META));
  else await db.meta.delete(readerOffKey(reader));
}

/** Sets `flag` on or off. */
export async function saveFlag(db: LedgerDb, flag: SettableFlag, on: boolean): Promise<void> {
  await db.meta.put(parseWrite(Choice, { key: flagKey(flag), value: on }, REFUSED, META));
}
