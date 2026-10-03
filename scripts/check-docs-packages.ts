/**
 * The package.json files a quoted `pnpm` command can run a script from, for scripts/check-docs.ts (QA-G10). A
 * script is looked up in the package the command runs in, never in the union of all of them: `pnpm test:tz` at
 * the repo root fails ("missing script") because only extension/package.json defines it.
 * - a command in a directory runs the scripts of the nearest package.json at or above it (as pnpm does);
 * - `--filter <name>` picks workspace packages by name (`*` matches anything), `--filter ./dir` or `{dir}` by
 *   directory;
 * - a recursive run (`-r`, `pnpm recursive …`) runs in every workspace package but the root (the root too with
 *   `--include-workspace-root`), so one of them must define the script.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { PnpmTarget } from './check-docs-commands';

/** The workspace's package.json files, relative to the root: the root first, then the workspace packages. */
export const PACKAGE_FILES = ['package.json', 'extension/package.json'];

export interface PackageScripts {
  /** The package.json, relative to the root. */
  readonly file: string;
  /** Its directory, relative to the root ('.' for the root). */
  readonly dir: string;
  readonly name: string | null;
  readonly scripts: ReadonlySet<string>;
}

export interface Workspace {
  readonly root: string;
  /** Every package.json read so far, by directory; null where a directory has none. */
  readonly byDir: Map<string, PackageScripts | null>;
}

type Report = (file: string, line: number, message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The package.json in `dir`, read once; null when there is none; empty scripts (reported) when unreadable. */
function packageAt(workspace: Workspace, dir: string, report: Report | null): PackageScripts | null {
  const cached = workspace.byDir.get(dir);
  if (cached !== undefined) return cached;
  const file = dir === '.' ? 'package.json' : `${dir}/package.json`;
  const full = path.join(workspace.root, file);
  let found: PackageScripts | null = null;
  if (existsSync(full)) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(full, 'utf8'));
    } catch {
      json = undefined;
    }
    const scripts = isRecord(json) ? json.scripts : undefined;
    if (!isRecord(scripts)) report?.(file, 0, 'cannot read "scripts" from this package.json');
    const name = isRecord(json) && typeof json.name === 'string' ? json.name : null;
    found = { file, dir, name, scripts: new Set(isRecord(scripts) ? Object.keys(scripts) : []) };
  }
  workspace.byDir.set(dir, found);
  return found;
}

/** Reads the workspace's package.json files, reporting any that is missing or has no readable "scripts". */
export function workspacePackages(root: string, report: Report): Workspace {
  const workspace: Workspace = { root, byDir: new Map() };
  for (const file of PACKAGE_FILES) {
    const dir = path.posix.dirname(file);
    if (packageAt(workspace, dir, report) === null)
      report(file, 0, 'cannot read "scripts" from this package.json');
  }
  return workspace;
}

function members(workspace: Workspace): PackageScripts[] {
  return PACKAGE_FILES.map((file) => workspace.byDir.get(path.posix.dirname(file)) ?? null).filter(
    (found): found is PackageScripts => found !== null,
  );
}

/** The union of some packages' scripts, and how to name them in a message. */
function union(found: readonly PackageScripts[]): { scripts: ReadonlySet<string>; where: string } {
  return {
    scripts: new Set(found.flatMap((pkg) => [...pkg.scripts])),
    where: found.map((pkg) => pkg.file).join(' or '),
  };
}

/** The nearest package.json at or above `dir`. */
function nearest(workspace: Workspace, dir: string): PackageScripts | null {
  for (let at = dir; ; at = path.posix.dirname(at)) {
    const found = packageAt(workspace, at, null);
    if (found !== null) return found;
    if (at === '.') return null;
  }
}

/** The packages a `--filter` selector picks, run from `dir`. */
function filtered(workspace: Workspace, selector: string, dir: string): PackageScripts[] {
  const bare = selector.replace(/^!/, '').replace(/^\.\.\.\^?|\^?\.\.\.$/g, '');
  if (bare.startsWith('.') || bare.startsWith('{')) {
    const target = path.posix.normalize(path.posix.join(dir, bare.replace(/^\{|\}$/g, '')));
    const found = target.startsWith('..') ? null : packageAt(workspace, target.replace(/\/$/, ''), null);
    return found === null ? [] : [found];
  }
  const glob = new RegExp(
    `^${bare
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  return members(workspace).filter((pkg) => pkg.name !== null && glob.test(pkg.name));
}

/** The scripts an invocation can run, and where they come from; or the reason that cannot be known. */
export function scriptsFor(
  workspace: Workspace,
  target: PnpmTarget,
): { scripts: ReadonlySet<string>; where: string } | { problem: string } {
  if (target.kind === 'unknown')
    return { problem: `cannot tell which package.json it runs in (${target.reason})` };
  if (target.kind === 'dir') {
    const found = nearest(workspace, target.dir);
    return found === null ? { problem: `no package.json at or above ${target.dir}` } : union([found]);
  }
  if (target.kind === 'filter') {
    const found = filtered(workspace, target.selector, target.dir);
    return found.length === 0
      ? { problem: `--filter '${target.selector}' selects no package` }
      : union(found);
  }
  const all = members(workspace);
  return union(target.includeRoot ? all : all.filter((pkg) => pkg.dir !== '.'));
}
