/**
 * The local-path check of scripts/check-docs.ts (TECH-R13): committed Markdown names files by paths relative to the
 * repository, never by where one machine keeps them. An absolute local path is useless to every other reader, and
 * it leaks the account name and scratch layout of the machine that wrote it once the repository is public.
 *
 * Scope: every `.md` file under the root, at any depth (docs/, README.md, PRIVACY.md, CHANGELOG.md, Decisions.md,
 * reviews/, sprints/, agents/, extension/…), except in `node_modules`, in dot-directories (`.git`, `.output`, `.wxt`)
 * and in the test and coverage output directories the repository ignores. Every line is read, code and HTML comments
 * included: they are committed too.
 *
 * Reported: a macOS or Linux home directory with a name after it (`/Users/<name>`, `/home/<name>`), a temporary or
 * per-user system directory with a path after it (`/private/tmp/…`, `/private/var/…`, `/var/folders/…`, `/tmp/…`), a
 * Windows profile (`C:\Users\<name>`), and a `file:///` URL. A match must start a path: one that continues a word,
 * a relative path or a URL (`extension/Users/x`, `https://host/home/x`) is not local.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Directories that are never committed (.gitignore): dependencies, build, test and coverage output. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'test-results',
  'playwright-report',
  'coverage',
  'blob-report',
]);

/** Starts a path: not inside a word, a relative path or a URL. */
const PATH_START = String.raw`(?<![\w.~%+\-/\\])`;
const SEGMENT = String.raw`[\w.~-]`;
const LOCAL_PATH = new RegExp(
  [
    String.raw`${PATH_START}/(?:Users|home)/${SEGMENT}+`,
    String.raw`${PATH_START}/private/(?:tmp|var)(?=/${SEGMENT})`,
    String.raw`${PATH_START}/var/folders/${SEGMENT}+`,
    String.raw`${PATH_START}/tmp/${SEGMENT}+`,
    String.raw`${PATH_START}[A-Za-z]:[\\/]Users[\\/]${SEGMENT}+`,
    String.raw`\bfile:///`,
  ].join('|'),
  'g',
);

/** One absolute local path: the 1-based line and the matched start of the path. */
export interface LocalPath {
  readonly line: number;
  readonly path: string;
}

function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The Markdown files under `root` (see the file comment), relative to it with forward slashes, sorted. */
export function markdownFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path.join(dir, entry.name), relative);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(relative);
      }
    }
  };
  walk(root, '');
  return found.sort(byCodeUnit);
}

/** Every absolute local path in `text`, in order. */
export function localPaths(text: string): LocalPath[] {
  const found: LocalPath[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(LOCAL_PATH)) found.push({ line: index + 1, path: match[0] });
  });
  return found;
}

/** Checks every Markdown file under `root`; returns how many were read. */
export function checkLocalPaths(
  root: string,
  report: (file: string, line: number, message: string) => void,
): number {
  const files = markdownFiles(root);
  for (const file of files) {
    for (const hit of localPaths(readFileSync(path.join(root, file), 'utf8'))) {
      report(file, hit.line, `absolute local path '${hit.path}': write a path relative to the repository`);
    }
  }
  return files.length;
}
