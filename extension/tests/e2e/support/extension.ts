/**
 * Launches Chromium with the unpacked Attest build in a fresh profile and exposes it to tests.
 * Uses Playwright's bundled Chromium (branded Chrome no longer honours --load-extension).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BrowserContext, chromium, errors, type Page, type Worker } from '@playwright/test';

/**
 * The unpacked build under test. ATTEST_EXTENSION_PATH points at another build (used to prove that a
 * deliberately broken build fails the mandatory tests); CI never sets it.
 */
export const EXTENSION_PATH =
  process.env.ATTEST_EXTENSION_PATH ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.output/chrome-mv3');

export interface LaunchOptions {
  /**
   * Extra Chromium switches, e.g. NetLog capture for the mandatory tests. A function gets the launch attempt
   * (0, 1, 2), so a retried start writes its NetLog to a file of its own and none is overwritten.
   */
  readonly extraArgs?: readonly string[] | ((attempt: number) => readonly string[]);
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

/**
 * Chromium for Testing on macOS sometimes never finishes starting when an extension service worker runs
 * code: measured on the founder's Mac (Intel, native) at about 3-7% of launches of any Attest build, the
 * committed Sprint 0 build included, and 0 of 70 with an empty extension. A hung start never recovers (none
 * of the hung launches finished within 120 s), while a healthy one takes about 1 s. So a start that has not
 * finished in LAUNCH_TIMEOUT_MS is killed and a new browser is started, at most LAUNCH_ATTEMPTS times, each
 * loudly logged. Only browser start-up is repeated, never a test step or an assertion; tests that capture
 * NetLog give each attempt its own file and analyse every one (Decisions.md [0.close], QA-4, QA-V2).
 */
export const LAUNCH_TIMEOUT_MS = 15_000;
export const LAUNCH_ATTEMPTS = 3;
/** Bounded wait for the extension's worker: a stuck start fails with its own message, inside the test timeout. */
export const SERVICE_WORKER_TIMEOUT_MS = 30_000;

/** Closes a context and removes its profile; used when a launch fails after the browser started. */
async function discard(context: BrowserContext, userDataDir: string, ownsProfile: boolean): Promise<void> {
  await context.close().catch((error: unknown) => {
    console.warn('[e2e] closing a failed launch also failed', error);
  });
  if (ownsProfile) rmSync(userDataDir, { recursive: true, force: true });
}

/** Starts Chromium with the extension, replacing a start-up that hangs (see LAUNCH_TIMEOUT_MS). */
async function startBrowser(
  options: LaunchOptions,
): Promise<{ context: BrowserContext; userDataDir: string }> {
  for (let attempt = 0; ; attempt += 1) {
    const userDataDir = options.userDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'attest-e2e-'));
    const extraArgs =
      typeof options.extraArgs === 'function' ? options.extraArgs(attempt) : options.extraArgs;
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        timeout: LAUNCH_TIMEOUT_MS,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          ...(extraArgs ?? []),
        ],
      });
      return { context, userDataDir };
    } catch (error) {
      if (options.userDataDir === undefined) rmSync(userDataDir, { recursive: true, force: true });
      if (!(error instanceof errors.TimeoutError) || attempt + 1 >= LAUNCH_ATTEMPTS) throw error;
      console.warn(
        `[e2e] Chromium start-up hung for ${String(LAUNCH_TIMEOUT_MS / 1000)} s ` +
          `(attempt ${String(attempt + 1)} of ${String(LAUNCH_ATTEMPTS)}); starting a new browser`,
      );
    }
  }
}

export async function launchExtension(options: LaunchOptions = {}): Promise<LaunchedExtension> {
  if (!existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error(`No extension build at ${EXTENSION_PATH}. Run \`pnpm build\` first (pnpm e2e does).`);
  }
  const ownsProfile = options.userDataDir === undefined;
  const { context, userDataDir } = await startBrowser(options);

  const serviceWorker = async (): Promise<Worker> => {
    const [existing] = context.serviceWorkers().filter((w) => w.url().startsWith('chrome-extension://'));
    if (existing) return existing;
    try {
      return await context.waitForEvent('serviceworker', { timeout: SERVICE_WORKER_TIMEOUT_MS });
    } catch (error) {
      throw new Error(
        `The extension service worker did not start within ${String(SERVICE_WORKER_TIMEOUT_MS / 1000)} s`,
        { cause: error },
      );
    }
  };
  let extensionId: string;
  try {
    extensionId = new URL((await serviceWorker()).url()).host;
  } catch (error) {
    await discard(context, userDataDir, ownsProfile);
    throw error;
  }

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
