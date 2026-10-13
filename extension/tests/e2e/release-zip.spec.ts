/**
 * The store zip's check fails a zip that is not a store build or does not install clean
 * (extension/tests/tools/check-release-zip.ts, which `pnpm build:release` runs through scripts/check-release.ts;
 * sprint_7 7.0; QA review, sprint 7; Sprint 7 close, SEC-5, TECH-13, QA-7). The release zip itself waits for the
 * deployed telemetry host (MANUAL.md, Sprint 5), so the zips here are made from the build `pnpm e2e` made, each in a
 * temporary folder, made a release build as `pnpm build:release` would make it: without the development pages and their
 * code (src/config-manifest.ts DEV_ENTRYPOINTS), with a telemetry host that is not `.invalid`. So made, it passes.
 * Keeping a development page or its code, naming a `.invalid` host, another name, description or version; without its
 * popup page, with a popup or a digest that throws, with an options page that logs an error, or with a service worker
 * that logs one as it starts or cannot start at all: the check exits non-zero.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { TELEMETRY_HOST } from '../../src/config';
import { DEV_ENTRYPOINTS } from '../../src/config-manifest';
import { EXTENSION_PATH } from './support/extension';

const EXTENSION_DIR = path.resolve(import.meta.dirname, '../..');
const TOOL = path.join(EXTENSION_DIR, 'tests', 'tools', 'check-release-zip.ts');
/** A telemetry host as a release names one, in place of the build's `.invalid` stand-in. */
const RELEASE_HOST = 'telemetry.example.com';

/** Changes the manifest in `dir` by `change`. */
function changeManifest(
  dir: string,
  change: (manifest: Record<string, unknown>) => Record<string, unknown>,
): void {
  const file = path.join(dir, 'manifest.json');
  writeFileSync(
    file,
    JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)),
  );
}

/** Puts `line` first in the script `file` of `dir`. */
function prepend(file: string, line: string): void {
  writeFileSync(file, `${line}\n${readFileSync(file, 'utf8')}`);
}

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
    for (const name of DEV_ENTRYPOINTS) {
      rmSync(path.join(dir, `${name}.html`), { force: true });
      for (const chunk of readdirSync(path.join(dir, 'chunks')).filter((file) => file.startsWith(`${name}-`)))
        rmSync(path.join(dir, 'chunks', chunk));
    }
    const manifest = path.join(dir, 'manifest.json');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replaceAll(TELEMETRY_HOST, RELEASE_HOST));
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

test.describe('the store zip check (check-release-zip): what the zip holds', () => {
  test.setTimeout(180_000);

  test('passes the build as zipped', () => {
    const { status, output } = checkZipOfBuild(() => undefined);
    expect(output).toContain('is a store build and installs on a clean profile');
    expect(output).toContain('digest.html');
    expect(status).toBe(0);
  });

  test('fails a zip that keeps a development page, or its code', () => {
    const page = checkZipOfBuild((dir) => {
      writeFileSync(path.join(dir, 'dev.html'), '<!doctype html><title>dev</title>');
    });
    expect(page.output).toContain('it holds the development page dev.html');
    expect(page.status).toBe(1);
    const code = checkZipOfBuild((dir) => {
      writeFileSync(path.join(dir, 'chunks', 'model-check-qa.js'), 'export {};\n');
    });
    expect(code.output).toContain("it holds the development page model-check's code");
    expect(code.status).toBe(1);
  });

  test('fails a zip whose manifest names a .invalid host', () => {
    const { status, output } = checkZipOfBuild((dir) => {
      const file = path.join(dir, 'manifest.json');
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll(RELEASE_HOST, TELEMETRY_HOST));
    });
    expect(output).toContain('its manifest names a .invalid host');
    expect(status).toBe(1);
  });

  test("fails a zip whose manifest's name, description or version is not the build's", () => {
    const named = checkZipOfBuild((dir) => {
      changeManifest(dir, (manifest) => ({ ...manifest, name: 'Attest' }));
    });
    expect(named.output).toContain("the manifest's name is not the build's");
    const described = checkZipOfBuild((dir) => {
      changeManifest(dir, (manifest) => ({ ...manifest, description: 'Checks your agents.' }));
    });
    expect(described.output).toContain("the manifest's description is not the package's");
    const versioned = checkZipOfBuild((dir) => {
      changeManifest(dir, (manifest) => ({ ...manifest, version: '0.0.9' }));
    });
    expect(versioned.output).toContain("the manifest's version is not the package's");
    expect([named.status, described.status, versioned.status]).toEqual([1, 1, 1]);
  });
});

test.describe('the store zip check (check-release-zip): how it installs', () => {
  test.setTimeout(180_000);

  test('fails a zip without its popup page', () => {
    const { status } = checkZipOfBuild((dir) => {
      rmSync(path.join(dir, 'popup.html'));
    });
    expect(status).not.toBe(0);
  });

  test('fails a zip whose popup, or digest, throws as it loads', () => {
    for (const page of ['popup.html', 'digest.html']) {
      const { status, output } = checkZipOfBuild((dir) => {
        prepend(pageScript(dir, page), `throw new Error('qa: a broken ${page}');`);
      });
      expect(output).toContain(`${page}: an uncaught exception`);
      expect(status).toBe(1);
    }
  });

  test('fails a zip whose options page logs an error', () => {
    const { status, output } = checkZipOfBuild((dir) => {
      prepend(pageScript(dir, 'options.html'), "console.error('qa: an error');");
    });
    expect(output).toContain('options.html: a console error');
    expect(status).toBe(1);
  });

  test('fails a zip whose service worker logs an error as it starts', () => {
    const { status, output } = checkZipOfBuild((dir) => {
      prepend(path.join(dir, 'background.js'), "console.error('qa: a worker error');");
    });
    expect(output).toContain('the service worker: a console error');
    expect(status).toBe(1);
  });

  test('fails a zip whose service worker cannot start', () => {
    const { status } = checkZipOfBuild((dir) => {
      writeFileSync(path.join(dir, 'background.js'), "throw new Error('qa: a broken worker');\n");
    });
    expect(status).not.toBe(0);
  });
});
