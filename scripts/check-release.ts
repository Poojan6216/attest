/**
 * The checks `pnpm build:release` runs on the store zip once `wxt zip` has made it (sprint_7 7.0; Sprint 7 close, QA
 * review QA-7): the zip of this version, `extension/.output/attest-<version>.zip` (wxt.config.ts `zipTemplate`, the
 * version extension/package.json's), audited (./audit-manifest.ts), then checked to be a store build that installs on a
 * clean Chrome profile (extension/tests/tools/check-release-zip.ts, run as `pnpm --dir extension run
 * check-release-zip`). The zip is named from the version, never found by a pattern: a pattern also takes an older
 * version's zip, a development one (named `-dev`), or none at all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The store zip of the version extension/package.json under `root` holds, as a path from `root`; refused when absent. */
export function releaseZip(root: string): string {
  const version: unknown = (
    JSON.parse(readFileSync(path.join(root, 'extension', 'package.json'), 'utf8')) as { version?: unknown }
  ).version;
  if (typeof version !== 'string') throw new Error('check-release: extension/package.json has no version');
  const zip = path.join('extension', '.output', `attest-${version}.zip`);
  if (!existsSync(path.join(root, zip))) throw new Error(`check-release: no ${zip}; run pnpm build:release`);
  return zip;
}

/**
 * The two checks run on `zip` (a path from `root`), in order: each a command and its arguments, run from `root`. The
 * install check is the extension's own script (extension/package.json `check-release-zip`), given the zip's full path.
 */
export function releaseChecks(root: string, zip: string): (readonly [string, readonly string[]])[] {
  return [
    ['pnpm', ['audit:manifest', zip]],
    ['pnpm', ['--dir', 'extension', 'run', 'check-release-zip', path.join(root, zip)]],
  ];
}

function main(): void {
  for (const [command, args] of releaseChecks(ROOT, releaseZip(ROOT))) {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
