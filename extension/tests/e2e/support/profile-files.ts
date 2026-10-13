/**
 * A Chrome profile's IndexedDB files read as bytes, as a forensic tool reads a copied profile, without Chrome (security
 * review SEC-1 at the Sprint 6 close). Chrome keeps an origin's databases in one LevelDB store. A put never overwrites
 * in place: it is appended to the log, then written to table files whose blocks are usually compressed. A replaced or
 * deleted version goes only when a compaction rewrites the files that hold it. So this reads every file under the
 * profile's `IndexedDB` folder and decodes both kinds of LevelDB file:
 *  - the log's records, joined across its 32 KiB blocks;
 *  - every block of every table, decompressed.
 * It then decodes each stored value Chrome compressed itself, and searches all of it for the given values. Each value
 * is searched as Latin-1 and as UTF-16LE, the two ways V8 writes a string into a stored value. The scan answers which
 * values it found and how many files it read. It never returns the bytes. A file it cannot decode is named in
 * `unparsed`: a test that claims nothing was found must also find nothing unparsed. Formats: leveldb's
 * doc/log_format.md and doc/table_format.md, and Snappy's format_description.txt.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const LOG_BLOCK = 32_768;
const LOG_HEADER = 7;
const LOG_FULL = 1;
const LOG_FIRST = 2;
const LOG_MIDDLE = 3;
const LOG_LAST = 4;
const FOOTER = 48;
/** kTableMagicNumber, 0xdb4775248b80fb57, as written: fixed64, little-endian. */
const TABLE_MAGIC = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
const BLOCK_TRAILER = 5;
const NO_COMPRESSION = 0;
const SNAPPY = 1;
/** Blink's mark on a stored value it compressed: the version tag, its "needs processing" pseudo-version, Snappy. */
const VALUE_SNAPPY_MARK = Buffer.from([0xff, 0x11, 0x02]);

export interface ProfileScan {
  /** Every file read under the profile's IndexedDB folder. */
  readonly files: number;
  /** The LevelDB tables and logs decoded. */
  readonly decoded: number;
  /** Files of a LevelDB kind that did not decode: anything found or not found in them is unknown. */
  readonly unparsed: readonly string[];
  /** Which of the values looked for appear anywhere, decoded or raw. */
  readonly found: readonly string[];
  /** The files any of them appear in, by name. */
  readonly where: readonly string[];
}

class Reader {
  constructor(
    readonly bytes: Buffer,
    public at = 0,
  ) {}

  varint(): number {
    let result = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      const byte = this.bytes[this.at];
      if (byte === undefined) throw new Error('a varint runs past the end');
      this.at += 1;
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
    }
    throw new Error('a varint is too long');
  }

  take(length: number): Buffer {
    if (this.at + length > this.bytes.length) throw new Error('a length runs past the end');
    const slice = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return slice;
  }
}

/** Snappy's raw format: a varint length, then literals and back-references. Throws on anything malformed. */
export function snappyUncompress(input: Buffer): Buffer {
  const reader = new Reader(input);
  const out = Buffer.alloc(reader.varint());
  let written = 0;
  const copy = (offset: number, length: number): void => {
    if (offset === 0 || offset > written || written + length > out.length)
      throw new Error('a bad back-reference');
    for (let i = 0; i < length; i += 1) {
      out[written] = out[written - offset] ?? 0;
      written += 1;
    }
  };
  while (reader.at < input.length) {
    const tag = reader.take(1)[0] ?? 0;
    const kind = tag & 3;
    if (kind === 0) {
      let length = tag >>> 2;
      if (length >= 60) {
        const extra = reader.take(length - 59);
        length = extra.reduce((sum, byte, i) => sum + byte * 2 ** (8 * i), 0);
      }
      const literal = reader.take(length + 1);
      if (written + literal.length > out.length) throw new Error('a literal runs past the length');
      literal.copy(out, written);
      written += literal.length;
    } else if (kind === 1) {
      copy(((tag >>> 5) << 8) | (reader.take(1)[0] ?? 0), ((tag >>> 2) & 7) + 4);
    } else {
      const offset = reader.take(kind === 2 ? 2 : 4);
      copy(
        offset.reduce((sum, byte, i) => sum + byte * 2 ** (8 * i), 0),
        (tag >>> 2) + 1,
      );
    }
  }
  if (written !== out.length) throw new Error('shorter than its length');
  return out;
}

/** The log's records, each joined from its fragments. */
export function logRecords(bytes: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let pending: Buffer[] = [];
  for (let block = 0; block < bytes.length; block += LOG_BLOCK) {
    const end = Math.min(block + LOG_BLOCK, bytes.length);
    for (let at = block; at + LOG_HEADER <= end;) {
      const length = bytes.readUInt16LE(at + 4);
      const type = bytes[at + 6];
      if (type === 0 && length === 0) break;
      // A record cut off at the end of the file is one Chrome was writing: LevelDB itself drops it on reading.
      if (at + LOG_HEADER + length > end && end === bytes.length) return records;
      if (at + LOG_HEADER + length > end) throw new Error('a record runs past its block');
      const fragment = bytes.subarray(at + LOG_HEADER, at + LOG_HEADER + length);
      at += LOG_HEADER + length;
      if (type === LOG_FULL) records.push(fragment);
      else if (type === LOG_FIRST) pending = [fragment];
      else if (type === LOG_MIDDLE) pending.push(fragment);
      else if (type === LOG_LAST) {
        records.push(Buffer.concat([...pending, fragment]));
        pending = [];
      } else throw new Error('a record of no known type');
    }
  }
  return records;
}

/** A log record is a write batch: a sequence, a count, then puts (key and value) and deletions (key alone). */
function batchValues(record: Buffer): Buffer[] {
  const reader = new Reader(record, 12);
  const values: Buffer[] = [];
  while (reader.at < record.length) {
    const kind = reader.take(1)[0];
    reader.take(reader.varint());
    if (kind === 1) values.push(reader.take(reader.varint()));
    else if (kind !== 0) throw new Error('a batch entry of no known kind');
  }
  return values;
}

function blockContents(bytes: Buffer, offset: number, size: number): Buffer {
  const raw = bytes.subarray(offset, offset + size);
  const type = bytes[offset + size];
  if (raw.length !== size || offset + size + BLOCK_TRAILER > bytes.length)
    throw new Error('a block runs past the end');
  if (type === NO_COMPRESSION) return raw;
  if (type === SNAPPY) return snappyUncompress(raw);
  throw new Error(`a block compressed as ${String(type)}, which this does not decode`);
}

/** A block's entries: keys shared with the one before, then the rest of the key, then the value. */
function blockValues(block: Buffer): Buffer[] {
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 * (restarts + 1);
  const reader = new Reader(block);
  const values: Buffer[] = [];
  while (reader.at < end) {
    reader.varint();
    const unshared = reader.varint();
    const length = reader.varint();
    reader.take(unshared);
    values.push(reader.take(length));
  }
  return values;
}

/** Every value of a table's data blocks, read through its index block. */
export function tableValues(bytes: Buffer): Buffer[] {
  if (bytes.length < FOOTER || !bytes.subarray(bytes.length - 8).equals(TABLE_MAGIC)) {
    throw new Error('no table footer');
  }
  const footer = new Reader(bytes, bytes.length - FOOTER);
  footer.varint();
  footer.varint();
  const index = blockContents(bytes, footer.varint(), footer.varint());
  return blockValues(index).flatMap((handle) => {
    const reader = new Reader(handle);
    return blockValues(blockContents(bytes, reader.varint(), reader.varint()));
  });
}

/** A stored value Blink compressed, uncompressed; anything else as it is. */
function storedValue(value: Buffer): Buffer[] {
  const mark = value.indexOf(VALUE_SNAPPY_MARK);
  if (mark < 0 || mark > 10) return [value];
  try {
    return [value, snappyUncompress(value.subarray(mark + VALUE_SNAPPY_MARK.length))];
  } catch {
    return [value];
  }
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.isFile() ? [full] : [];
  });
}

/** A file's bytes, or undefined when Chrome removed it after it was listed (a profile in use). */
function readIfThere(file: string): Buffer | undefined {
  try {
    return readFileSync(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Searches every IndexedDB file of the profile at `userDataDir` (header). */
export function scanProfileIndexedDb(userDataDir: string, lookFor: readonly string[]): ProfileScan {
  return scanFiles(path.join(userDataDir, 'Default', 'IndexedDB'), lookFor);
}

/**
 * Searches every file of the profile at `userDataDir`: Chrome's other LevelDB stores, the extension's own storage
 * among them, decoded as IndexedDB's are, and every other file as it is. A `.log` file that is not LevelDB's is named
 * in `unparsed`, and still searched as it is.
 */
export function scanProfileFiles(userDataDir: string, lookFor: readonly string[]): ProfileScan {
  return scanFiles(path.join(userDataDir, 'Default'), lookFor);
}

function scanFiles(dir: string, lookFor: readonly string[]): ProfileScan {
  const files = filesUnder(dir);
  const needles = lookFor.map((value) => [Buffer.from(value, 'latin1'), Buffer.from(value, 'utf16le')]);
  const unparsed: string[] = [];
  const found = new Set<number>();
  const where: string[] = [];
  let decoded = 0;
  for (const file of files) {
    const bytes = readIfThere(file);
    if (bytes === undefined) continue;
    const chunks: Buffer[] = [bytes];
    const name = path.basename(file);
    try {
      if (name.endsWith('.log') && name !== 'LOG') {
        chunks.push(...logRecords(bytes).flatMap(batchValues).flatMap(storedValue));
        decoded += 1;
      } else if (name.endsWith('.ldb') || name.endsWith('.sst')) {
        chunks.push(...tableValues(bytes).flatMap(storedValue));
        decoded += 1;
      }
    } catch {
      unparsed.push(name);
    }
    const here = needles.flatMap((pair, i) =>
      pair.some((needle) => chunks.some((chunk) => chunk.includes(needle))) ? [i] : [],
    );
    here.forEach((i) => found.add(i));
    if (here.length > 0) where.push(`${name} (${String(here.length)})`);
  }
  return { files: files.length, decoded, unparsed, found: lookFor.filter((_, i) => found.has(i)), where };
}
