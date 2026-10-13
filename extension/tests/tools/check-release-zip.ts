/**
 * The store zip is a release build and installs on a clean Chrome profile (sprint_7 7.0, Done when; Sprint 7 close,
 * security review SEC-5, tech review TECH-13, QA review QA-7): `pnpm build:release` runs this on the zip it made, after
 * the manifest audit. First what the zip holds: no development page or its chunk (src/config-manifest.ts
 * DEV_ENTRYPOINTS), no `.invalid` host anywhere in its manifest, and the manifest's name, description and version the
 * build's. Then it is unpacked into a temporary folder and loaded by Chromium with a new, empty profile, behind the dead
 * proxy every end-to-end launch uses (tests/e2e/support/extension.ts). It passes when the service worker starts and
 * logs no console error or warning, heard from the moment it appears, and the popup, the side panel, the options page
 * and the digest open with no console error or warning and no uncaught exception. The folder and the profile are
 * deleted after. Only the kinds of what went wrong are printed, never a message's text.
 *
 *   tsx extension/tests/tools/check-release-zip.ts extension/.output/attest-<version>.zip
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEV_ENTRYPOINTS, MANIFEST_NAME } from '../../src/config-manifest';
import { launchExtension } from '../e2e/support/extension';

const PAGES = ['popup.html', 'sidepanel.html', 'options.html', 'digest.html'] as const;
const PACKAGE = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../package.json'), 'utf8')) as {
  readonly version?: unknown;
  readonly description?: unknown;
};

const reported = (type: string): boolean => type === 'error' || type === 'warning';

/** What the unpacked zip at `dir` holds that a store build must not (header). */
function contentProblems(dir: string): string[] {
  const problems: string[] = [];
  const chunks = existsSync(path.join(dir, 'chunks')) ? readdirSync(path.join(dir, 'chunks')) : [];
  for (const name of DEV_ENTRYPOINTS) {
    if (existsSync(path.join(dir, `${name}.html`)))
      problems.push(`it holds the development page ${name}.html`);
    if (chunks.some((chunk) => chunk.startsWith(`${name}-`)))
      problems.push(`it holds the development page ${name}'s code`);
  }
  const text = readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(text) as Record<string, unknown>;
  if (/\.invalid\b/u.test(text))
    problems.push('its manifest names a .invalid host: the telemetry host is not set');
  if (manifest.name !== MANIFEST_NAME) problems.push("the manifest's name is not the build's");
  if (manifest.description !== PACKAGE.description)
    problems.push("the manifest's description is not the package's");
  if (manifest.version !== PACKAGE.version)
    problems.push(`the manifest's version is not the package's (${String(PACKAGE.version)})`);
  return problems;
}

/** What went wrong when the build at `dir` was installed and its pages opened (header). */
async function installProblems(dir: string): Promise<string[]> {
  const extension = await launchExtension({ extensionPath: dir });
  const problems: string[] = [];
  try {
    for (const page of PAGES) {
      const tab = await extension.context.newPage();
      tab.on('console', (message) => {
        if (reported(message.type())) problems.push(`${page}: a console ${message.type()}`);
      });
      tab.on('pageerror', () => {
        problems.push(`${page}: an uncaught exception`);
      });
      await tab.goto(`chrome-extension://${extension.extensionId}/${page}`);
      await tab.waitForLoadState('networkidle');
      await tab.close();
    }
    for (const message of extension.workerConsole) {
      if (reported(message.type())) problems.push(`the service worker: a console ${message.type()}`);
    }
  } finally {
    await extension.close();
  }
  return problems;
}

async function check(zip: string): Promise<string[]> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-release-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', dir]);
    const problems = contentProblems(dir);
    return problems.length > 0 ? problems : await installProblems(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const [zip, ...rest] = process.argv.slice(2);
if (zip === undefined || rest.length > 0) {
  process.stderr.write('usage: tsx extension/tests/tools/check-release-zip.ts <the zip>\n');
  process.exit(2);
}
const problems = await check(zip);
if (problems.length > 0) {
  process.stderr.write(
    `check-release-zip: ${path.basename(zip)} is not a store build that installs clean:\n- ${problems.join('\n- ')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `check-release-zip: ${path.basename(zip)} is a store build and installs on a clean profile; ${PAGES.join(', ')} open clean.\n`,
);
