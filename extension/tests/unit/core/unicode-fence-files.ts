/**
 * The files the unicode fence reads (unicode-fence.spec.ts; SEC-1, Hard Rule 4): every file under src/core, however
 * deep, since src/core/tsconfig.json compiles `./**\/*.ts`. A file that is not a `.ts` source (a `.js`, `.mts`,
 * `.cts` or `.tsx` file, a link, anything but the top-level tsconfig.json) is reported, never skipped: the scan
 * reads only TypeScript, so such a file could hold anything. Shared with the later-engine property, which must
 * run every export of the files the fence lets normalise.
 */
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The only src/core files that may call `normalize`: the later-engine property
 * (tests/property/unicode-baseline.property.spec.ts) runs every export of each, and checks it runs these files.
 */
export const READER_FILES: ReadonlySet<string> = new Set([
  'normalize-text.ts',
  'normalize-amount.ts',
  'normalize-relative.ts',
]);

export interface CoreFiles {
  /** The `.ts` files the scan reads, as sorted `/`-separated paths relative to the root: all but `tables`. */
  readonly sources: readonly string[];
  /** The generated tables found at the top level (unicode-tables.spec.ts checks them). */
  readonly tables: readonly string[];
  /** Every other file: not a `.ts` file (or not a file at all), and not the top-level tsconfig.json. */
  readonly others: readonly string[];
}

/** Every file under `root`, in every directory, sorted into what the fence reads, the tables and the rest. */
export function coreFiles(root: string, tableSources: ReadonlySet<string>): CoreFiles {
  const sources: string[] = [];
  const tables: string[] = [];
  const others: string[] = [];
  const entries = readdirSync(root, { recursive: true, encoding: 'utf8' });
  for (const file of entries.map((entry) => entry.split(path.sep).join('/')).sort()) {
    const stat = lstatSync(path.join(root, file));
    if (stat.isDirectory()) continue;
    if (stat.isFile() && file === 'tsconfig.json') continue;
    if (!stat.isFile() || !file.endsWith('.ts')) others.push(file);
    else (tableSources.has(file) ? tables : sources).push(file);
  }
  return { sources, tables, others };
}
