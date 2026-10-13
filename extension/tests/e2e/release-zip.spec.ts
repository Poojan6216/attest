/**
 * The store zip's install check fails a broken zip (extension/tests/tools/check-release-zip.ts, which `pnpm
 * build:release` runs through scripts/check-release.ts; sprint_7 7.0; QA review, sprint 7). The release zip itself waits
 * for the deployed telemetry host (MANUAL.md, Sprint 5), so the zips here are made from the build `pnpm e2e` made, each
 * in a temporary folder, without the development pages a release build leaves out (wxt.config.ts DEV_ENTRYPOINTS): as
 * built, it installs clean; without its popup page, with a popup that throws, with an options page that logs an error,
 * with a service worker that cannot start, or with a manifest of another version, the check exits non-zero.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { DEV_ENTRYPOINTS } from '../../wxt.config';
import { EXTENSION_PATH } from './support/extension';

const EXTENSION_DIR = path.resolve(import.meta.dirname, '../..');
const TOOL = path.join(EXTENSION_DIR, 'tests', 'tools', 'check-release-zip.ts');

/** The script a built page loads first, from its `<script type="module" src>`. */
function pageScript(dir: string, page: string): string {
  const html = readFileSync(path.join(dir, page), 'utf8');
  const src = /<script type="module"[^>]* src="\/([^"]+)"/u.exec(html)?.[1];
  if (src === undefined) throw new Error(`${page} loads no module script`);
  return path.join(dir, src);
}

/** Runs the check on a zip of the build, after `breakIt` changes the copy; its exit status and what it printed. */
function checkZipOfBuild(breakIt: (dir: string) => void): { status: number | null; output: string } {
  const work = mkdtempSync(path.join(os.tmpdir(), 'attest-qa-zip-'));
  try {
    const dir = path.join(work, 'build');
    cpSync(EXTENSION_PATH, dir, { recursive: true });
    for (const name of DEV_ENTRYPOINTS) rmSync(path.join(dir, `${name}.html`), { force: true });
    breakIt(dir);
    const zip = path.join(work, 'attest.zip');
    execFileSync('zip', ['-qr', zip, '.'], { cwd: dir });
    const run = spawnSync('pnpm', ['exec', 'tsx', TOOL, zip], {
      cwd: EXTENSION_DIR,
      encoding: 'utf8',
      timeout: 150_000,
    });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

test.describe('the store zip install check (check-release-zip)', () => {
  test.setTimeout(180_000);

  test('passes the build as zipped', () => {
    const { status, output } = checkZipOfBuild(() => undefined);
    expect(output).toContain('installs on a clean profile');
    expect(status).toBe(0);
  });

  test('fails a zip without its popup page', () => {
    const { status } = checkZipOfBuild((dir) => {
      rmSync(path.join(dir, 'popup.html'));
    });
    expect(status).not.toBe(0);
  });

  test('fails a zip whose popup throws as it loads', () => {
    const { status, output } = checkZipOfBuild((dir) => {
      const script = pageScript(dir, 'popup.html');
      writeFileSync(script, `throw new Error('qa: a broken popup');\n${readFileSync(script, 'utf8')}`);
    });
    expect(output).toContain('popup.html: an uncaught exception');
    expect(status).toBe(1);
  });

  test('fails a zip whose options page logs an error', () => {
    const { status, output } = checkZipOfBuild((dir) => {
      const script = pageScript(dir, 'options.html');
      writeFileSync(script, `console.error('qa: an error');\n${readFileSync(script, 'utf8')}`);
    });
    expect(output).toContain('options.html: a console error');
    expect(status).toBe(1);
  });

  test('fails a zip whose service worker cannot start', () => {
    const { status } = checkZipOfBuild((dir) => {
      writeFileSync(path.join(dir, 'background.js'), "throw new Error('qa: a broken worker');\n");
    });
    expect(status).not.toBe(0);
  });

  test('fails a zip whose manifest is of another version', () => {
    const { status, output } = checkZipOfBuild((dir) => {
      const file = path.join(dir, 'manifest.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      writeFileSync(file, JSON.stringify({ ...manifest, version: '0.0.9' }));
    });
    expect(output).toContain("the manifest's version is not the package's");
    expect(status).toBe(1);
  });
});
