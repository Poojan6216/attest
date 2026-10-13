/**
 * Sprint 2.0 Done-when: "a fixture page with the skeleton posts a coverage.ping within 1 s of load", in a real
 * Chromium, with the real src/observers skeleton and the real src/bus `send()` (which validates every message).
 *
 * The extension build is not involved: the skeleton runs from a test-only bundle of tests/e2e/support/
 * observer-harness.ts, injected into the synthetic fixture page with a recording stand-in for `browser.runtime`.
 * So no host permission is added for the fixture server and no test code reaches the shipped build
 * (tests/e2e/built-bundle.spec.ts checks both). Each page also records every DOM mutation after load and every
 * input event: the skeleton must cause none (Hard Rule 3).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';

import { BusMessage } from '../../src/bus/messages';
import { OBSERVER_DEBOUNCE_MS, OBSERVER_MAX_WAIT_MS } from '../../src/config';
import { accountHashOf } from '../../src/observers/account';
import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';
import { OBSERVER_HARNESS_MARKER } from './support/observer-harness-marker';
import { bundleTestScript } from './support/test-bundle';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HARNESS_ENTRY = path.join(ROOT, 'tests/e2e/support/observer-harness.ts');
/** The Done-when bound. */
const PING_WITHIN_MS = 1_000;

interface Post {
  readonly at: number;
  readonly message: unknown;
}

/** Bundles the harness entry into one classic script (IIFE), in memory. */
const bundleHarness = (): Promise<string> => bundleTestScript(HARNESS_ENTRY, 'AttestObserverHarness');

/** Before any page script: the recording runtime, then the mutation and input recorders, then the harness. */
async function installHarness(context: BrowserContext, bundle: string): Promise<void> {
  await context.addInitScript(() => {
    const posts: { at: number; message: unknown }[] = [];
    const mutations: number[] = [];
    const inputs: string[] = [];
    Object.defineProperty(window, '__attestPosts', { value: posts });
    Object.defineProperty(window, '__attestMutations', { value: mutations });
    Object.defineProperty(window, '__attestInputs', { value: inputs });
    const runtime = {
      id: 'attest-observer-harness',
      lastError: undefined,
      sendMessage(message: unknown, callback: (response?: unknown) => void): void {
        posts.push({ at: performance.now(), message: JSON.parse(JSON.stringify(message)) as unknown });
        setTimeout(() => {
          callback(undefined);
        }, 0);
      },
    };
    Object.defineProperty(globalThis, 'browser', { value: { runtime }, configurable: true });
    for (const type of [
      'click',
      'pointerdown',
      'mousedown',
      'keydown',
      'keyup',
      'input',
      'change',
      'submit',
    ]) {
      window.addEventListener(type, (event) => inputs.push(event.type), { capture: true });
    }
    window.addEventListener('load', () => {
      new MutationObserver((records) => mutations.push(records.length)).observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
    });
  });
  await context.addInitScript({ content: bundle });
}

async function posts(page: Page): Promise<Post[]> {
  return page.evaluate(() => Array.from(Reflect.get(window, '__attestPosts') as Post[]));
}

async function loadedAt(page: Page): Promise<number> {
  return page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation');
    if (!(entry instanceof PerformanceNavigationTiming) || entry.loadEventStart === 0)
      throw new Error('not loaded');
    return entry.loadEventStart;
  });
}

function messages(list: readonly Post[]): BusMessage[] {
  return list.map((post) => BusMessage.parse(post.message));
}

function types(list: readonly Post[]): string[] {
  return messages(list).map((message) => message.type);
}

let bundle = '';
let server: FixtureServer;
let context: BrowserContext;

test.beforeAll(async () => {
  bundle = await bundleHarness();
  server = await startFixtureServer();
});

test.afterAll(async () => {
  await server.close();
});

test.beforeEach(async () => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  context = await browser.newContext();
  await installHarness(context, bundle);
});

test.afterEach(async () => {
  const browser = context.browser();
  await context.close();
  await browser?.close();
});

async function open(file: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(server.url(`_harness/${file}`), { waitUntil: 'load' });
  return page;
}

test('the harness bundle is the skeleton, marked so a shipped build can be checked for it', () => {
  expect(bundle).toContain(OBSERVER_HARNESS_MARKER);
  expect(bundle).toContain('coverage.ping');
});

test('a fixture page with the skeleton posts a coverage.ping within 1 s of load', async () => {
  const page = await open('synthetic-observer.html');
  await expect.poll(async () => types(await posts(page)), { timeout: 5_000 }).toContain('coverage.ping');
  const list = await posts(page);
  const ping = list.find((post) => BusMessage.parse(post.message).type === 'coverage.ping');
  const sinceLoad = (ping?.at ?? Number.POSITIVE_INFINITY) - (await loadedAt(page));
  console.log(`[observer-skeleton] first coverage.ping ${sinceLoad.toFixed(0)} ms after load`);
  expect(sinceLoad).toBeLessThanOrEqual(PING_WITHIN_MS);
  expect(types(list)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
});

test('what the clean pass posts: allowlisted fields only, the account as a hash, one instant', async () => {
  const page = await open('synthetic-observer.html');
  await expect.poll(async () => types(await posts(page)), { timeout: 5_000 }).toContain('coverage.ping');
  const [health, observations, ping] = messages(await posts(page));
  expect(health).toMatchObject({ health: { adapterId: 'harness.sent', status: 'OK', reasons: [] } });
  if (observations?.type !== 'observer.observations' || ping?.type !== 'coverage.ping')
    throw new Error('order');
  const at = ping.ping.lastSyncAt;
  expect(health?.type === 'adapter.health' ? health.health.checkedAt : null).toBe(at);
  expect(observations.observations.map((o) => [o.counterparty, o.subjectHint, o.observedAt])).toEqual([
    ['alex@example.com', 'Q3 deck and plan', at],
    ['sam@example.org', 'Re: invoice', at],
  ]);
  expect(ping.ping).toEqual({
    observerId: 'harness.sent',
    // sprint_2 2.7 interface 1: every ping names the one source its observer reads.
    source: 'gmail.sent',
    accountHash: accountHashOf('harness.user@example.com'),
    lastSyncAt: at,
    windowStart: '2026-10-01T13:10:00-04:00',
    windowEnd: at,
    userActive: false,
  });
  const wire = JSON.stringify(await posts(page)).toLowerCase();
  for (const leak of ['harness.user', 'body text', 'snippet']) expect(wire).not.toContain(leak);
  expect(await page.evaluate(() => Reflect.get(window, '__attestMutations') as number[])).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, '__attestInputs') as string[])).toEqual([]);
});

test('the Drafts page: DEGRADED health within 1 s of load, and no observations or coverage ever', async () => {
  const page = await open('synthetic-observer-drafts.html');
  await expect.poll(async () => (await posts(page)).length, { timeout: 5_000 }).toBeGreaterThan(0);
  const [first] = await posts(page);
  expect((first?.at ?? Number.POSITIVE_INFINITY) - (await loadedAt(page))).toBeLessThanOrEqual(
    PING_WITHIN_MS,
  );
  await page.waitForTimeout(OBSERVER_MAX_WAIT_MS + OBSERVER_DEBOUNCE_MS);
  const list = messages(await posts(page));
  expect(list.map((m) => m.type)).toEqual(['adapter.health']);
  expect(list[0]).toMatchObject({ health: { status: 'DEGRADED', reasons: ['not_sent_folder'] } });
});

test('a row project() refuses: DEGRADED, the good row, and no coverage (Sprint 1 close, SEC-3)', async () => {
  const page = await open('synthetic-observer-refused.html');
  await expect
    .poll(async () => types(await posts(page)), { timeout: 5_000 })
    .toContain('observer.observations');
  await page.waitForTimeout(OBSERVER_MAX_WAIT_MS + OBSERVER_DEBOUNCE_MS);
  const list = messages(await posts(page));
  expect(list.map((m) => m.type)).toEqual(['adapter.health', 'observer.observations']);
  expect(list[0]).toMatchObject({ health: { status: 'DEGRADED', reasons: ['redact.invalid_field'] } });
  const [, observations] = list;
  expect(observations?.type === 'observer.observations' ? observations.observations.length : 0).toBe(1);
});

test('a DOM change makes another pass; the user-activity flag follows real input', async () => {
  const page = await open('synthetic-observer.html');
  await expect.poll(async () => types(await posts(page)), { timeout: 5_000 }).toContain('coverage.ping');
  const before = (await posts(page)).length;
  await page.mouse.move(20, 20);
  await page.mouse.move(40, 60);
  // The test changes its own fixture page, as the vendor's scripts would; the skeleton only watches.
  await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]');
    const row = grid?.querySelector('[role="row"]')?.cloneNode(true);
    if (!(row instanceof Element) || grid === null) throw new Error('no row');
    row.setAttribute('data-row-key', 'h-3');
    row.querySelector('time')?.setAttribute('datetime', '2026-10-01T14:20:00-04:00');
    grid.prepend(row);
  });
  await expect
    .poll(async () => types((await posts(page)).slice(before)), { timeout: OBSERVER_MAX_WAIT_MS + 1_000 })
    .toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
  const [, observations, ping] = messages((await posts(page)).slice(before));
  expect(observations?.type === 'observer.observations' ? observations.observations.length : 0).toBe(3);
  expect(ping?.type === 'coverage.ping' ? ping.ping.userActive : null).toBe(true);
});

/** How long the page below changes, 100 times a second (sprint_6 6.4). */
const CHURN_MS = 6_000;

test('under a page changing every 10 ms (100 a second asked, more than 50 held) the skeleton reads once per max wait, and still reads (sprint_6 6.4)', async () => {
  const page = await open('synthetic-observer.html');
  await expect.poll(async () => types(await posts(page)), { timeout: 5_000 }).toContain('coverage.ping');
  const start = await page.evaluate(() => performance.now());
  // The test changes its own fixture page, as a busy vendor page might: a row's snippet rewritten every 10 ms.
  const changes = await page.evaluate(
    (ms) =>
      new Promise<number>((resolve) => {
        const snippet = document.querySelector('[role="grid"] [data-snippet]');
        let count = 0;
        const timer = setInterval(() => {
          count += 1;
          if (snippet !== null) snippet.textContent = `Changed ${String(count)}`;
        }, 10);
        setTimeout(() => {
          clearInterval(timer);
          resolve(count);
        }, ms);
      }),
    CHURN_MS,
  );
  const end = await page.evaluate(() => performance.now());
  const during = (await posts(page)).filter((post) => post.at > start && post.at <= end);
  const passes = types(during).filter((type) => type === 'adapter.health').length;
  console.log(
    `[observer-batching] ${String(changes)} changes in ${String(CHURN_MS)} ms: ${String(passes)} passes`,
  );
  // The page asks for 100 changes a second; a loaded machine's timers give fewer, so this holds more than 50 a second,
  // which the title says (Sprint 6 close, tech review TECH-13).
  expect(changes).toBeGreaterThan(CHURN_MS / 20);
  // At most one pass per max wait while the page never settles, and at least one each max wait but the last.
  expect(passes).toBeLessThanOrEqual(Math.ceil(CHURN_MS / OBSERVER_MAX_WAIT_MS) + 1);
  expect(passes).toBeGreaterThanOrEqual(Math.floor(CHURN_MS / OBSERVER_MAX_WAIT_MS) - 1);
});
