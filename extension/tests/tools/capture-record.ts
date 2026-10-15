/**
 * Where a re-fake writes the record of what replaced what (./capture-refake.ts, ./capture-refake-people.ts): never
 * inside the repository, since the record holds the old fakes, and owner-only (Sprint 7 security re-run, SEC-R1). The
 * check resolves symbolic links and ignores letter case, as this Mac's disk does, and reads a name such as
 * `..people.json` at the repository's root as inside it, not above it. The record is written before any page is
 * rewritten, so a record that cannot be written loses nothing.
 */
import { realpathSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository's root. */
export const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** `target` with every symbolic link in its deepest existing folder resolved, and the rest as written. */
function resolved(target: string): string {
  const absolute = path.resolve(target);
  try {
    return realpathSync.native(absolute);
  } catch {
    const parent = path.dirname(absolute);
    return parent === absolute ? absolute : path.join(resolved(parent), path.basename(absolute));
  }
}

/** Whether `target` is `root` or anywhere under it, links resolved and letter case ignored. */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(resolved(root).toLowerCase(), resolved(target).toLowerCase());
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Writes `text` to `file`, owner-only even when the file was there before. */
export async function writeRecord(file: string, text: string): Promise<void> {
  await writeFile(file, text, { mode: 0o600 });
  await chmod(file, 0o600);
}
