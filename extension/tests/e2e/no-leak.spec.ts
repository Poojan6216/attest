/**
 * @mandatory — Hard Rules 2 and 10: derived facts only; never log secrets.
 *
 * Every seeded secret (tests/fixtures/secrets/seeded.json) is injected into the fixture pages the
 * extension sees, a log holding every seed is pasted into the side panel and imported (sprint_3 3.13), and the Gmail
 * and Calendar fixtures (VENDOR_PAGES, sprint_2 2.7) are opened as they are, with the
 * seeds in their own bodies, at the vendors' own addresses (./support/vendor-pages.ts), so the observers really read
 * them and real rows reach the ledger before the channels are searched. After a session, no seed value or canary fragment may appear in: the extension's
 * own ledger export, any IndexedDB database, any chrome.storage area, the extension origin's web storage
 * and CacheStorage, the web storage, IndexedDB or cookies of the pages it reads, console output from any
 * context, any network URL or body, the opt-in telemetry's payloads, sent and shown (sprint_5 5.7: turned on, and the
 * seeded day's numbers sent from the options page to a stand-in for the API), or the share output (sprint_4 4.7: the weekly
 * digest the session's ledger makes, through its alarm, as the digest page would copy it; searched as written and with
 * its markdown escapes removed). The person's own model key (sprint_5 5.3), saved through the options page, may be in its
 * own slot of chrome.storage.local and in no channel otherwise (./support/byo-key.ts). Later sprints extend the page
 * list with real vendor fixtures; the channels stay. The negative control plants
 * a seed in each channel, some of them lightly transformed, and proves the collectors catch it. Never
 * skipped, retried, or weakened.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import { STORAGE_KEYS } from '../../src/config';
import { unescapeMarkdown } from '../../src/ui/markdown';
import { startFixtureServer } from '../tools/serve-fixtures';
import {
  collectPageChannels,
  collectStorageChannels,
  type PageChannels,
  plantIndexedDbProbe,
  recordConsole,
  type StorageChannels,
} from './support/channels';
import { makeDigestNow, readShare } from './support/digest';
import { launchExtension } from './support/extension';
import { findLeaks, type Leak, loadSeeds, type Seed } from './support/leaks';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import { guardArgs, installRouteGuard, type RouteRecord } from './support/network-guard';
import { datedClock, pasteActivity, seededLog } from './support/paste';
import { injectSeeds } from './support/seed-pages';
import { plantInConsole, plantInDigest, plantInNetwork, plantInPage } from './support/leak-plants';
import { readReceiptShares } from './support/share';
import { BYO_KEY_SEED, plantKey, saveKey, withoutKeySlot } from './support/byo-key';
import { plantInModel, stubAnthropic, type VendorRequest } from './support/model-vendor';
import { askAboutPriya } from './support/priya';
import { plantInTelemetry, sendTodaysNumbers, stubTelemetry, turnTelemetryOn } from './support/telemetry';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  requestUrl,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

declare const chrome: WxtBrowser;

const SEEDS = loadSeeds();
const SEEDED_PAGES = ['_harness/blank.html', '_harness/mail-like.html', '_harness/calendar-like.html'];
const EXTENSION_PAGES = ['popup.html', 'options.html', 'sidepanel.html'];

/** A claim whose counterparty is a name written with a dot (security review SEC-1): stored, and never shared. */
const DOTTED_NAME_LOG = ['Texted J.Smith that the deck is ready', datedClock(20, FIXTURE_TIME_ZONE)].join(
  '\n',
);
/** Observer fixtures served as they are: each holds three seeds where real secrets sit (snippets, bodies, places). */
const VENDOR_PAGES = [
  vendorFixture('gmail', 'synthetic-sent-page-1.html'),
  vendorFixture('gmail', 'synthetic-receipt-amazon.html'),
  vendorFixture('gcal', 'synthetic-gcal-week-before.html'),
  // Real captures (2026-10-06): their seeds go through content script, bus, ledger and export too (QA-R5).
  vendorFixture('gmail', 'sent-list-1.html'),
  vendorFixture('gcal', 'week-after.html'),
  // Real receipts (2026-10-07): their seeds sit in the bodies the receipt reader reads (QA third review).
  vendorFixture('gmail', 'receipt-stripe.html'),
  vendorFixture('gmail', 'receipt-uber.html'),
];
/** The Gmail Sent list the own key's call is about (./support/priya.ts): one more page, searched as the others. */
const MODEL_PAGES = 1;
const SETTLE_MS = 5_000;

interface Collected {
  readonly storage: StorageChannels;
  readonly pages: PageChannels;
  readonly consoleLines: readonly string[];
  readonly routeRecords: readonly RouteRecord[];
  readonly netLogUrls: readonly string[];
  /** Each share the session read, as written and with its markdown escapes removed. */
  readonly share: readonly string[];
  /** Each telemetry payload sent to the stand-in API, and each the options page showed (sprint_5 5.7). */
  readonly telemetry: readonly string[];
  /**
   * What the model vendor's stand-in received (Sprint 5 close, QA GAP 5): each request's body and headers, but its
   * `x-api-key`, the one place the person's key belongs.
   */
  readonly model: readonly string[];
  /** How many POSTs the vendor received. */
  readonly modelPosts: number;
}

/** The key's leaks: every channel searched for the invented key, its own storage slot taken out (./support/byo-key.ts). */
function keyLeaks(collected: Collected): Leak[] {
  const storage = { ...collected.storage, storage: withoutKeySlot(collected.storage.storage) };
  return allLeaks({ ...collected, storage }, [BYO_KEY_SEED]);
}

function allLeaks(collected: Collected, seeds: readonly Seed[]): Leak[] {
  return [
    ...findLeaks('ledger-export', collected.storage.ledgerExport, seeds),
    ...findLeaks('indexeddb', collected.storage.indexedDb, seeds),
    ...findLeaks('chrome-storage', collected.storage.storage, seeds),
    ...findLeaks('web-storage', collected.storage.webStorage, seeds),
    ...findLeaks('cache-storage', collected.storage.cacheStorage, seeds),
    ...findLeaks('page-storage', collected.pages.pageStorage, seeds),
    ...findLeaks('cookies', collected.pages.cookies, seeds),
    ...findLeaks('console', collected.consoleLines, seeds),
    ...findLeaks(
      'network',
      [...collected.netLogUrls, ...collected.routeRecords.map((r) => `${r.url} ${r.body} ${r.headers}`)],
      seeds,
    ),
    ...findLeaks('share', collected.share, seeds),
    ...findLeaks('telemetry', collected.telemetry, seeds),
    ...findLeaks('model', collected.model, seeds),
  ];
}

/** A request the vendor received, as searched: its body and its headers, without the key's own header. */
const modelChannel = ({ body, headers }: VendorRequest): string =>
  `${body} ${JSON.stringify(Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'x-api-key')))}`;

const seed = (id: string): Seed => {
  const found = SEEDS.find((s) => s.id === id);
  if (!found) throw new Error(`seed ${id} missing from seeded.json`);
  return found;
};

/** Runs `act` inside a guarded extension session and returns everything every channel holds. */
interface SessionContext {
  readonly extension: Awaited<ReturnType<typeof launchExtension>>;
  readonly seededUrl: (page: string) => string;
  /** Where the session puts each telemetry payload the options page showed. */
  readonly shown: string[];
  /** The pages the guard serves at their own addresses; the session may add one. */
  readonly routes: Map<string, string>;
}

/** The pages the guard serves at their addresses: the seeded pages at `seededUrl`, and the vendor fixtures. */
function routedPages(seededUrl: (page: string) => string): Map<string, string> {
  const routedFixtures = new Map<string, string>();
  for (const page of SEEDED_PAGES) {
    routedFixtures.set(
      seededUrl(page),
      injectSeeds(readFileSync(path.join(import.meta.dirname, '../fixtures/pages', page), 'utf8'), SEEDS),
    );
  }
  for (const fixture of VENDOR_PAGES) {
    routedFixtures.set(requestUrl(fixtureUrl(fixture)), readFileSync(fixture.htmlPath, 'utf8'));
  }
  return routedFixtures;
}

async function collectAfter(
  act: (ctx: SessionContext) => Promise<readonly string[] | undefined>,
): Promise<Collected> {
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-noleak-'));
  const seededUrl = (page: string) => server.url(`_seeded/${page}`);
  const routedFixtures = routedPages(seededUrl);
  const consoleLines: string[] = [];
  let storage: StorageChannels;
  let pages: PageChannels;
  let routeRecords: readonly RouteRecord[];
  let shares: readonly string[];
  let sent: readonly string[];
  let asked: readonly VendorRequest[];
  const shown: string[] = [];
  // One NetLog per browser launch attempt; every one is searched (tests/e2e/support/extension.ts).
  const extension = await launchExtension({
    extraArgs: (attempt) => guardArgs(netLogPathFor(dir, attempt)),
    timezoneId: FIXTURE_TIME_ZONE,
  });
  try {
    // A live array: the guard appends every blocked request until the browser closes.
    routeRecords = await installRouteGuard(extension.context, {
      fixtureOrigin: server.origin,
      routedFixtures,
    });
    // A stand-in for the telemetry API, after the guard so it answers first: every body sent to it is kept.
    sent = await stubTelemetry(extension.context);
    // A stand-in for Anthropic's API, likewise: every request the person's own key makes is kept (QA GAP 5).
    asked = await stubAnthropic(extension.context);
    recordConsole(await extension.serviceWorker(), 'service-worker', consoleLines);
    extension.context.on('page', (page) => {
      recordConsole(page, page.url() || 'page', consoleLines);
    });
    shares = (await act({ extension, seededUrl, shown, routes: routedFixtures })) ?? [];
    const probe = await extension.openExtensionPage('options.html');
    storage = await collectStorageChannels(probe, extension.context);
    pages = await collectPageChannels(extension.context);
  } finally {
    await extension.close();
    await server.close();
  }
  const netLogUrls = readNetLogRequests(dir).map((r) => r.url);
  rmSync(dir, { recursive: true, force: true });
  const share = shares.flatMap((text) => [text, unescapeMarkdown(text)]);
  const telemetry = [...sent, ...shown];
  return { storage, pages, consoleLines, routeRecords, netLogUrls, share, telemetry, ...modelOf(asked) };
}

/** The model channel and the count of POSTs, from what the vendor's stand-in received (QA GAP 5). */
const modelOf = (asked: readonly VendorRequest[]) => ({
  model: asked.map(modelChannel),
  modelPosts: asked.filter(({ method }) => method === 'POST').length,
});

/**
 * Opens the Gmail and Calendar fixtures at their live addresses, checks their own seeds are on the page, and waits
 * until every observer stored rows from them: real data flowed before the channels are read.
 */
async function openVendorPages(extension: Awaited<ReturnType<typeof launchExtension>>): Promise<void> {
  for (const fixture of VENDOR_PAGES) {
    const tab = await extension.context.newPage();
    await tab.goto(fixtureUrl(fixture));
    for (const id of fixture.label.seededSecrets) {
      await expect(tab.locator(`[data-attest-seeded="${id}"]`).first()).toBeAttached();
    }
  }
  await waitForLedger(await extension.openExtensionPage('options.html'), (ledger) =>
    ['gmail.sent', 'gmail.receipt', 'gcal.event'].every((source) =>
      ledger.tables.observations.some((row) => row.source === source),
    ),
  );
}

/** The negative control's plants into the extension origin: chrome.storage, IndexedDB, web storage, caches. */
async function plantInExtension(page: Page): Promise<void> {
  await page.evaluate(([key, compact]) => chrome.storage.local.set({ probe: key, probe2: compact }), [
    seed('api_key_openai_shape').value,
    'GlacierMinnowTrumpet',
  ] as const);
  // Open the ledger through the export, then write a row behind its back.
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'ledger.export' } }),
  );
  await plantIndexedDbProbe(page, seed('person_name_1').value);
  await page.evaluate(
    ([local, session]) => {
      localStorage.setItem('probe', local);
      sessionStorage.setItem('probe', session);
    },
    [seed('token_lowercase').value, seed('passphrase_hyphenated').value] as const,
  );
  await page.evaluate(async (body) => {
    const cache = await caches.open('probe');
    await cache.put('https://probe.invalid/x', new Response(body));
  }, seed('email_body_1').value);
}

/** Every plant the negative control makes, as `channel:seedId`: the collectors must catch each one. */
const PLANTED = [
  'chrome-storage:api_key_openai_shape',
  'chrome-storage:passphrase',
  'chrome-storage:byo_key',
  'console:byo_key',
  'indexeddb:person_name_1',
  'ledger-export:person_name_1',
  'web-storage:token_lowercase',
  'web-storage:passphrase_hyphenated',
  'cache-storage:email_body_1',
  'page-storage:phone_number',
  'page-storage:street_address',
  'page-storage:card_shape',
  'page-storage:email_local_part',
  'cookies:email_local_part',
  'console:email_body_2',
  'console:passphrase',
  'network:url_with_token',
  'network:person_name_2',
  'network:ssn_shape',
  'share:person_name_2',
  'telemetry:token_lowercase',
  'model:phone_number',
  'model:byo_key',
] as const;

/**
 * The seeded session: the seeded pages and the vendor fixtures read, every extension page opened, a log holding every
 * seed pasted and imported, then the week's digest made by its alarm with the clock advanced, and its share read as it
 * would be copied (sprint_4 4.7). Returns the share.
 */
async function seededSession({
  extension,
  seededUrl,
  shown,
  routes,
}: SessionContext): Promise<readonly string[]> {
  for (const page of SEEDED_PAGES) {
    const tab = await extension.context.newPage();
    await tab.goto(seededUrl(page));
    // The seeds really are on the page the extension sees.
    await expect(tab.locator('[data-attest-seeded]')).toHaveCount(SEEDS.length);
  }
  await openVendorPages(extension);
  for (const page of EXTENSION_PAGES) await extension.openExtensionPage(page);
  // The person's own model key, saved and turned on (sprint_5 5.3): it may be in its own storage slot and nowhere else,
  // and in the header of the one call it makes, about a claim that lands PARTIAL in its grace (QA GAP 5).
  await saveKey(extension);
  await askAboutPriya(extension, routes, await extension.openExtensionPage('options.html'));
  // A pasted log with every seed in it, imported through the side panel (sprint_3 3.13): the claims are stored
  // and graded, and no seed may reach any channel.
  const panel = await extension.openExtensionPage('sidepanel.html');
  expect(await pasteActivity(panel, 'Muse', seededLog(SEEDS, FIXTURE_TIME_ZONE))).toMatch(
    /^Imported 3 claims\.$/u,
  );
  // A name written with a dot is kept as its claim's counterparty, and never shared, as a domain or at all (SEC-1).
  const dotted = await extension.openExtensionPage('sidepanel.html');
  expect(await pasteActivity(dotted, 'Muse', DOTTED_NAME_LOG)).toBe('Imported 1 claim.');
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  // The week's digest, made by its alarm with the clock advanced, and its share as it would be copied (4.7), then
  // each receipt's share as it would be copied (4.8).
  await makeDigestNow(extension, await extension.openExtensionPage('options.html'));
  // The opt-in telemetry (sprint_5 5.7), turned on, and the seeded day's numbers sent: what went, and what the
  // options page showed, are the `telemetry` channel.
  await turnTelemetryOn(extension);
  shown.push(await sendTodaysNumbers(extension));
  return [(await readShare(extension)).share, ...(await readReceiptShares(extension))];
}

/** The negative control's session: a seed planted in each channel (PLANTED), the key in its own and two others. */
async function plantEverything({ extension, seededUrl }: SessionContext): Promise<readonly string[]> {
  await plantInExtension(await extension.openExtensionPage('options.html'));
  const fixture = await extension.context.newPage();
  await fixture.goto(seededUrl('_harness/blank.html'));
  await plantInPage(fixture);
  await plantInConsole(await extension.serviceWorker());
  await plantInNetwork(await extension.openExtensionPage('options.html'));
  await plantInDigest(await extension.openExtensionPage('options.html'));
  await plantKey(await extension.openExtensionPage('options.html'), await extension.serviceWorker());
  await plantInTelemetry(await extension.openExtensionPage('options.html'), seed('token_lowercase').value);
  await plantInModel(await extension.openExtensionPage('options.html'), [
    seed('phone_number').value,
    BYO_KEY_SEED.value,
  ]);
  return [(await readShare(extension)).share];
}

test.describe('no seeded secret leaks', { tag: '@mandatory' }, () => {
  test('seeded pages leave no trace in export, IndexedDB, storage, console, or network', async () => {
    test.setTimeout(3 * 60_000);
    const collected = await collectAfter(seededSession);
    // Every share was read, the week's and each receipt's, and holds no counterparty beyond its domain: no address at
    // all, and no name, even one written with a dot.
    const shared = collected.share.join('\n');
    expect(shared).toContain('# Attest weekly digest');
    expect(shared.split('# Attest receipt:').length - 1).toBeGreaterThanOrEqual(4 * 2);
    expect(shared).not.toMatch(/@/u);
    expect(shared.toLowerCase()).not.toContain('j.smith');

    // Every channel was actually read: an unreadable channel must never pass as "no leaks".
    expect(collected.storage.ledgerExport).toMatchObject({
      type: 'ui.result',
      kind: 'ledger.export',
      ok: true,
    });
    expect(Object.keys(collected.storage.indexedDb)).toContain('attest');
    expect(collected.storage.storage).toHaveProperty('local');
    expect(Object.keys(collected.storage.webStorage).length).toBeGreaterThanOrEqual(EXTENSION_PAGES.length);
    expect(Object.keys(collected.pages.pageStorage)).toHaveLength(
      SEEDED_PAGES.length + VENDOR_PAGES.length + MODEL_PAGES,
    );
    expect(collected.consoleLines.some((line) => line.startsWith('service-worker'))).toBe(true);

    expect(collected.storage.storage).toHaveProperty(['local', STORAGE_KEYS.BYO_KEY], BYO_KEY_SEED.value);
    // The key's one call was made, and searched.
    expect(collected.modelPosts).toBe(1);
    const leaks = [...allLeaks(collected, SEEDS), ...keyLeaks(collected)];
    for (const leak of leaks)
      console.log(`[no-leak] LEAK seed=${leak.seedId} channel=${leak.channel} at=${leak.location}`);
    expect(leaks).toEqual([]);
  });

  test('negative control: a seed planted in each channel is caught', async () => {
    test.setTimeout(2 * 60_000);
    const collected = await collectAfter(plantEverything);
    const caught = new Set(
      [...allLeaks(collected, SEEDS), ...keyLeaks(collected)].map((leak) => `${leak.channel}:${leak.seedId}`),
    );
    for (const expected of PLANTED) {
      expect(caught, expected).toContain(expected);
    }
  });
});
