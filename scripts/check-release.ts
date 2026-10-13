/**
 * The checks `pnpm build:release` runs on the store zip once `wxt zip` has made it (sprint_7 7.0): the zip of this
 * version, `extension/.output/attest-<version>.zip` (wxt.config.ts `zip.artifactTemplate`, the version
 * extension/package.json's), audited (./audit-manifest.ts), then installed on a clean Chrome profile
 * (extension/tests/tools/check-release-zip.ts). The zip is named from the version, never found by a pattern: a pattern
 * also takes an older version's zip, or none at all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const version: unknown = (
  JSON.parse(readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8')) as { version?: unknown }
).version;
if (typeof version !== 'string') throw new Error('check-release: extension/package.json has no version');
const zip = path.join('extension', '.output', `attest-${version}.zip`);
if (!existsSync(path.join(ROOT, zip))) throw new Error(`check-release: no ${zip}; run pnpm build:release`);

execFileSync('pnpm', ['audit:manifest', zip], { cwd: ROOT, stdio: 'inherit' });
execFileSync('pnpm', ['exec', 'tsx', 'extension/tests/tools/check-release-zip.ts', zip], {
  cwd: ROOT,
  stdio: 'inherit',
});
