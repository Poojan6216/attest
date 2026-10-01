/**
 * Fixture capture tool, end to end (does not need the extension build).
 *
 * A Chromium with a free --remote-debugging-port plays the founder's browser. The tool attaches over CDP,
 * captures the harness page, and must leave that page byte-identical (read-only). The output is then loaded
 * from a fixture server in a fresh browser that records every request: zero may leave the fixture server.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BrowserContext, chromium, expect, type Page, type Request, test } from '@playwright/test';

import { captureFixture } from '../tools/capture-fixture';
import { loadSeeds, SEEDS_PATH } from '../tools/capture-output';
import { findForeignAts } from '../tools/capture-pii';
import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';

declare global {
  interface Window {
    attestProbe?: { mutations: number; events: string[] };
  }
}

const EXTENSION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLE = '_harness/capture-sample.html';
const DATE = '2026-10-01';
const REDACT = ['[data-subject]', '.snippet'];
/** base64url("evt0042 priya.raman@northwind-traders.com"): a Google-Calendar-style event id. */
const EVENT_ID = 'ZXZ0MDA0MiBwcml5YS5yYW1hbkBub3J0aHdpbmQtdHJhZGVycy5jb20';
/** Every real-looking value in the harness page. None may survive into a fixture or the CLI output. */
const ORIGINALS = [
  'northwind-traders',
  'lindqvist-family',
  'Priya',
  'Raman',
  'Daniel',
  'Okafor',
  'Marcus',
  'Lindqvist',
  'Lena',
  'Hoffmann',
  'Ingrid',
  'Solberg',
  '555-0132',
  '7946 0958',
  '1,249.99',
  '89,50',
  '4,200.00',
  '221 Baker',
  'Springfield',
  '62704',
  '5555 4444 3333 1111',
  EVENT_ID,
  'csrf-9b1d2e7f',
  'n0nce-4f7a',
  'AF6bup-session-7c3e',
  'Q3 vendor contract',
  'Offsite agenda',
  'static.mail-vendor.example',
  'fonts.mail-vendor.example',
  'ads.mail-vendor.example',
  'ik=8f3a2c91',
  'draft=77',
  '__vendorBoot',
];
const OBSERVED_EVENTS = [
  'click',
  'dblclick',
  'auxclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'keydown',
  'keyup',
  'input',
  'change',
  'submit',
  'focus',
  'focusin',
  'blur',
  'scroll',
  'wheel',
  'beforeunload',
];

interface CdpChrome {
  readonly context: BrowserContext;
  readonly endpoint: string;
  readonly live: Page;
  close(): Promise<void>;
}

/** A persistent Chromium with a DevTools port, showing the harness page like the founder's open tab. */
async function launchCdpChrome(fixtures: FixtureServer): Promise<CdpChrome> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'attest-capture-chrome-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: ['--remote-debugging-port=0'],
  });
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  await expect.poll(() => existsSync(portFile), { timeout: 10_000 }).toBe(true);
  const [port = ''] = (await readFile(portFile, 'utf8')).split('\n');
  // The harness references hosts that do not exist; keep the live page hermetic.
  await context.route(
    (url) => url.origin !== fixtures.origin,
    (route) => route.abort(),
  );
  const live = context.pages()[0] ?? (await context.newPage());
  await live.goto(fixtures.url(SAMPLE));
  await live.locator('[data-late-row]').waitFor({ state: 'attached' });
  return {
    context,
    endpoint: `http://127.0.0.1:${port.trim()}`,
    live,
    async close() {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Records every DOM mutation and every user-ish event on the live page from now on. */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate((events) => {
    const probe = { mutations: 0, events: [] as string[] };
    new MutationObserver((records) => {
      probe.mutations += records.length;
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    for (const type of events) {
      window.addEventListener(
        type,
        (event) => {
          probe.events.push(`${event.type}:${event.isTrusted ? 'trusted' : 'synthetic'}`);
        },
        true,
      );
    }
    window.attestProbe = probe;
  }, OBSERVED_EVENTS);
}

function liveState(
  page: Page,
): Promise<{ html: string; scroll: number[]; active: string | null; url: string }> {
  return page.evaluate(() => ({
    html: document.documentElement.outerHTML,
    scroll: [window.scrollX, window.scrollY],
    active: document.activeElement?.tagName ?? null,
    url: location.href,
  }));
}

/** Loads a written fixture in a fresh browser; returns the page plus every request and page error seen. */
async function openFixture(
  outRoot: string,
  relative: string,
): Promise<{
  view: Page;
  foreign: string[];
  requests: number;
  errors: string[];
  close(): Promise<void>;
}> {
  const server = await startFixtureServer({ root: outRoot });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = await browser.newContext();
  const requested: string[] = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    requested.push(url);
    return url.startsWith(`${server.origin}/`) ? route.continue() : route.abort();
  });
  const view = await context.newPage();
  const errors: string[] = [];
  view.on('pageerror', (error) => errors.push(error.name));
  view.on('request', (request) => requested.push(request.url()));
  await view.goto(server.url(relative), { waitUntil: 'load' });
  await view.waitForLoadState('networkidle');
  return {
    view,
    foreign: requested.filter((url) => !url.startsWith(`${server.origin}/`)),
    requests: requested.length,
    errors,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

function runCli(args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    path.join(EXTENSION_ROOT, 'node_modules/.bin/tsx'),
    ['tests/tools/capture-fixture.ts', ...args],
    {
      cwd: EXTENSION_ROOT,
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return once(child, 'close').then(([code]: unknown[]) => ({
    code: typeof code === 'number' ? code : null,
    stdout,
    stderr,
  }));
}

// Traces are off: this spec drives its own browsers, and the shared test-results/ dir is not ours to race on.
test.use({ trace: 'off' });

let fixtures: FixtureServer;
let outRoot = '';

test.beforeAll(async () => {
  fixtures = await startFixtureServer();
});

test.afterAll(async () => {
  await fixtures.close();
});

test.beforeEach(async () => {
  outRoot = await mkdtemp(path.join(os.tmpdir(), 'attest-capture-out-'));
});

test.afterEach(async () => {
  await rm(outRoot, { recursive: true, force: true });
});

test('captures read-only and writes a fixture that renders standalone with zero outside requests', async () => {
  const chrome = await launchCdpChrome(fixtures);
  try {
    await installProbe(chrome.live);
    const before = await liveState(chrome.live);
    const liveRequests: string[] = [];
    const recordLive = (request: Request): void => {
      liveRequests.push(request.url());
    };
    chrome.context.on('request', recordLive);
    const result = await captureFixture({
      vendor: 'harness',
      name: 'capture-sample',
      cdp: chrome.endpoint,
      seed: 'e2e',
      date: DATE,
      tab: SAMPLE,
      names: ['Priya Raman'],
      redactSelectors: REDACT,
      outRoot,
    });
    chrome.context.off('request', recordLive);

    // Read-only: the live page is byte-identical, nothing mutated, no event fired, nothing fetched (the copy is
    // built in an inert document), and the browser lives on.
    expect(liveRequests).toEqual([]);
    expect(await liveState(chrome.live)).toEqual(before);
    expect(await chrome.live.evaluate(() => window.attestProbe)).toEqual({ mutations: 0, events: [] });
    expect(chrome.context.pages()).toContain(chrome.live);

    expect(result.htmlPath).toBe(path.join(outRoot, 'harness', DATE, 'capture-sample.html'));
    expect(result.source).toBe(fixtures.url(SAMPLE));
    const html = await readFile(result.htmlPath, 'utf8');
    expect(findForeignAts(html)).toEqual([]);
    expect(html).toContain('@example.');
    expect(html).toContain('data-late-row');
    for (const original of ORIGINALS) expect(html, original).not.toContain(original);
    expect(result.stats).toMatchObject({ card: 1 });
    expect(JSON.parse(await readFile(result.labelsPath, 'utf8'))).toEqual({
      'capture-sample.html': {
        capturedAt: DATE,
        selectorsVersion: null,
        seededSecrets: result.seededSecrets,
        expected: [],
        notes: '',
      },
    });
    await expectRendersStandalone(result.seededSecrets);
  } finally {
    await chrome.close();
  }
});

async function expectRendersStandalone(seededSecrets: readonly string[]): Promise<void> {
  const seeds = await loadSeeds(SEEDS_PATH);
  const opened = await openFixture(outRoot, `harness/${DATE}/capture-sample.html`);
  try {
    const { view } = opened;
    expect(opened.foreign).toEqual([]);
    expect(opened.requests).toBeGreaterThan(0);
    expect(opened.errors).toEqual([]);
    await expect(view.locator('script')).toHaveCount(0);
    const handlers = await view.evaluate(() =>
      Array.from(document.querySelectorAll('*')).flatMap((element) =>
        element.getAttributeNames().filter((name) => name.toLowerCase().startsWith('on')),
      ),
    );
    expect(handlers).toEqual([]);
    await expect(view.locator('[role="main"] [role="row"]')).toHaveCount(3);
    // The live colour came from an @media rule the sanitiser drops: only the inlined computed style keeps it.
    await expect(view.locator('[data-subject]').first()).toHaveCSS('color', 'rgb(17, 34, 51)');
    const eventId = (await view.locator('[data-eventid]').getAttribute('data-eventid')) ?? '';
    expect(Buffer.from(eventId, 'base64').toString('latin1')).toMatch(
      /^evt0042 [a-z]+\.[a-z]+@example\.(?:com|org|net)$/,
    );
    const seeded = view.locator('[role="main"] [data-attest-seeded]');
    await expect(seeded).toHaveCount(3);
    for (const [index, id] of seededSecrets.entries()) {
      await expect(seeded.nth(index)).toBeVisible();
      await expect(seeded.nth(index)).toHaveAttribute('data-attest-seeded', id);
      await expect(seeded.nth(index)).toHaveText(
        seeds.find((seed) => seed.id === id)?.value ?? '<missing seed>',
      );
    }
    expect(findForeignAts(await view.content())).toEqual([]);
  } finally {
    await opened.close();
  }
}

test('the pnpm capture CLI runs under tsx, refuses to overwrite, honours --force, and fails loud', async () => {
  test.setTimeout(120_000);
  const chrome = await launchCdpChrome(fixtures);
  try {
    const args = [
      '--vendor',
      'harness',
      '--name',
      'cli-sample',
      '--cdp',
      chrome.endpoint,
      '--date',
      DATE,
      '--seed',
      'cli',
      '--tab',
      'capture-sample',
      '--names',
      'Priya Raman',
      '--out-root',
      outRoot,
      ...REDACT.flatMap((selector) => ['--redact-selector', selector]),
    ];
    const first = await runCli(args);
    expect(first.stderr).toBe('');
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`captured ${fixtures.url(SAMPLE)}`);
    expect(first.stdout).toMatch(/seeded: [a-z0-9_]+, [a-z0-9_]+, [a-z0-9_]+/);
    for (const original of ORIGINALS) expect(first.stdout, original).not.toContain(original);
    const html = await readFile(path.join(outRoot, 'harness', DATE, 'cli-sample.html'), 'utf8');
    expect(findForeignAts(html)).toEqual([]);

    const again = await runCli(args);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('capture failed [exists]');
    expect(await readFile(path.join(outRoot, 'harness', DATE, 'cli-sample.html'), 'utf8')).toBe(html);

    expect((await runCli([...args, '--force'])).code).toBe(0);
    const wrongTab = await runCli([...args, '--force', '--tab', 'no-such-tab']);
    expect(wrongTab.stderr).toContain('capture failed [no_tab]');
    const noChrome = await runCli([...args, '--force', '--cdp', 'http://127.0.0.1:9']);
    expect(noChrome.stderr).toContain('capture failed [cdp_unreachable]');
    expect((await runCli(['--help'])).stdout).toContain('pnpm capture --vendor');

    expect(await chrome.live.evaluate(() => document.querySelectorAll('[role="row"]').length)).toBe(3);
  } finally {
    await chrome.close();
  }
});
