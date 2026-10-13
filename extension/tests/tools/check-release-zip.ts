/**
 * The store zip installs on a clean Chrome profile (sprint_7 7.0, Done when): `pnpm build:release` runs this on the zip
 * it made, after the manifest audit. The zip is unpacked into a temporary folder and loaded by Chromium with a new,
 * empty profile, behind the dead proxy every end-to-end launch uses (tests/e2e/support/extension.ts). It passes when
 * the service worker starts, the popup, the side panel and the options page open with no console error or warning and
 * no uncaught exception, and the manifest carries the package's version. The folder and the profile are deleted after.
 * Only the kinds of what went wrong are printed, never a message's text.
 *
 *   tsx extension/tests/tools/check-release-zip.ts extension/.output/attest-<version>.zip
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAGES = ['popup.html', 'sidepanel.html', 'options.html'] as const;
const PACKAGE_JSON = path.resolve(import.meta.dirname, '../../package.json');

const versionOf = (file: string): unknown =>
  (JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version;

async function check(zip: string): Promise<string[]> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-release-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', dir]);
    // The launcher loads the build this names (tests/e2e/support/extension.ts EXTENSION_PATH), read when it loads.
    process.env.ATTEST_EXTENSION_PATH = dir;
    const { launchExtension } = await import('../e2e/support/extension');
    const extension = await launchExtension();
    const problems: string[] = [];
    try {
      for (const page of PAGES) {
        const tab = await extension.context.newPage();
        tab.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning')
            problems.push(`${page}: a console ${message.type()}`);
        });
        tab.on('pageerror', () => {
          problems.push(`${page}: an uncaught exception`);
        });
        await tab.goto(`chrome-extension://${extension.extensionId}/${page}`);
        await tab.waitForLoadState('networkidle');
        await tab.close();
      }
    } finally {
      await extension.close();
    }
    const [built, packaged] = [versionOf(path.join(dir, 'manifest.json')), versionOf(PACKAGE_JSON)];
    if (built !== packaged)
      problems.push(`the manifest's version is not the package's (${String(packaged)})`);
    return problems;
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
    `check-release-zip: ${path.basename(zip)} does not install clean:\n- ${problems.join('\n- ')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `check-release-zip: ${path.basename(zip)} installs on a clean profile; ${PAGES.join(', ')} open clean.\n`,
);
