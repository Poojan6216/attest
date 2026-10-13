/**
 * The release step's own choices (scripts/check-release.ts, wxt.config.ts `zipTemplate`; Sprint 7 close, QA review QA-7,
 * security review SEC-5): the zip it checks is named from the package's version and refused when absent, never found by
 * a pattern; the manifest audit runs on that zip, then the install check; and only the release build is named as the
 * store zip, every other zip `-dev`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { releaseChecks, releaseZip } from '../../../../scripts/check-release';
import { zipTemplate } from '../../../wxt.config';

// As in tests/unit/manifest-hosts.spec.ts: `defineConfig` returns its argument, so the stub never loads WXT.
vi.mock('wxt', () => ({ defineConfig: (block: unknown) => block }));

const roots: string[] = [];

/** A repository root whose extension is at `version`, holding the zips named. */
function root(version: unknown, zips: readonly string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-release-root-'));
  roots.push(dir);
  mkdirSync(path.join(dir, 'extension', '.output'), { recursive: true });
  writeFileSync(path.join(dir, 'extension', 'package.json'), JSON.stringify({ version }));
  for (const zip of zips) writeFileSync(path.join(dir, 'extension', '.output', zip), '');
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the release step', () => {
  it("checks the zip named from the package's version, and refuses when it is absent", () => {
    const zip = path.join('extension', '.output', 'attest-0.1.0.zip');
    expect(releaseZip(root('0.1.0', ['attest-0.1.0.zip', 'attest-0.0.9.zip']))).toBe(zip);
    expect(() => releaseZip(root('0.1.0', ['attest-0.0.9.zip', 'attest-0.1.0-dev.zip']))).toThrow(
      /no extension\/\.output\/attest-0\.1\.0\.zip; run pnpm build:release/u,
    );
    expect(() => releaseZip(root(undefined, []))).toThrow(/has no version/u);
  });

  it("audits the manifest of that zip, then checks it installs as a store build, by the extension's script", () => {
    const zip = path.join('extension', '.output', 'attest-0.1.0.zip');
    expect(releaseChecks('/repo', zip)).toEqual([
      ['pnpm', ['audit:manifest', zip]],
      ['pnpm', ['--dir', 'extension', 'run', 'check-release-zip', path.join('/repo', zip)]],
    ]);
  });

  it('names only the release build as the store zip', () => {
    expect(zipTemplate(true)).toBe('{{name}}-{{version}}.zip');
    expect(zipTemplate(false)).toBe('{{name}}-{{version}}-dev.zip');
  });
});
