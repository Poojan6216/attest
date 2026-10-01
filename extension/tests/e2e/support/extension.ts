/**
 * Launches Chromium with the unpacked Attest build in a fresh profile and exposes it to tests.
 * Uses Playwright's bundled Chromium (branded Chrome no longer honours --load-extension).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BrowserContext, chromium, type Page, type Worker } from '@playwright/test';

/**
 * The unpacked build under test. ATTEST_EXTENSION_PATH points at another build (used to prove that a
 * deliberately broken build fails the mandatory tests); CI never sets it.
 */
export const EXTENSION_PATH =
  process.env.ATTEST_EXTENSION_PATH ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.output/chrome-mv3');

export interface LaunchOptions {
  /** Extra Chromium switches, e.g. NetLog capture for the network-intercept test. */
  readonly extraArgs?: readonly string[];
  /** Reuse a profile directory (for restart tests); a fresh temp dir by default. */
  readonly userDataDir?: string;
}

export interface LaunchedExtension {
  readonly context: BrowserContext;
  readonly extensionId: string;
  readonly userDataDir: string;
  serviceWorker(): Promise<Worker>;
  openExtensionPage(page: 'popup.html' | 'options.html' | 'sidepanel.html' | (string & {})): Promise<Page>;
  close(): Promise<void>;
}

export async function launchExtension(options: LaunchOptions = {}): Promise<LaunchedExtension> {
  if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`No extension build at ${EXTENSION_PATH}. Run \`pnpm build\` first (pnpm e2e does).`);
  }
  const ownsProfile = options.userDataDir === undefined;
  const userDataDir = options.userDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'attest-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      ...(options.extraArgs ?? []),
    ],
  });

  const serviceWorker = async (): Promise<Worker> => {
    const [existing] = context.serviceWorkers().filter((w) => w.url().startsWith('chrome-extension://'));
    return existing ?? (await context.waitForEvent('serviceworker'));
  };
  const extensionId = new URL((await serviceWorker()).url()).host;

  return {
    context,
    extensionId,
    userDataDir,
    serviceWorker,
    async openExtensionPage(page) {
      const tab = await context.newPage();
      await tab.goto(`chrome-extension://${extensionId}/${page}`);
      return tab;
    },
    async close() {
      await context.close();
      if (ownsProfile) rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
