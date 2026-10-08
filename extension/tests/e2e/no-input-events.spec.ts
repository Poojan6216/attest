/**
 * Hard Rule 3 (Attest never acts) at runtime: qa_tester rule 5 and build_spec §10 "E2E asserts no input
 * events dispatched". Added by the Sprint 0 QA review as the rail later sprints extend.
 *
 * A recorder is installed in every page before any of its own code runs. It counts input events of every
 * kind in the capture phase at `window`, whichever world dispatched them (a content script's isolated
 * world shares the DOM). After the extension has had the pages open, every count must be zero and no page
 * may have navigated. The negative control proves the recorder sees synthetic and trusted events.
 *
 * Sprint 2.7 adds the Gmail and Calendar fixtures (VENDOR_PAGES), opened at the vendors' own addresses through
 * routing (./support/vendor-pages.ts), so the shipped content scripts run their observers on them; the test checks
 * that every observer reported from them before it counts. Sprint 3 (adapters) adds its vendor pages the same way.
 * Not detectable here, and left to the `attest/no-act` lint rule: `.value =` writes and `.focus()`
 * (Playwright's own focus emulation produces focus events, so they are not counted).
 */
import type { BrowserContext, Page } from '@playwright/test';

import { type FixtureServer, startFixtureServer } from '../tools/serve-fixtures';
import { type LaunchedExtension, launchExtension } from './support/extension';
import { installRouteGuard } from './support/network-guard';
import { expect, test } from './support/test';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  routesFor,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

const FIXTURE_PAGES = ['_harness/blank.html', '_harness/mail-like.html', '_harness/calendar-like.html'];
/** The Gmail Sent list, an opened receipt, a Calendar week and a month, each with its content script running. */
const VENDOR_PAGES = [
  vendorFixture('gmail', 'synthetic-sent-page-1.html'),
  vendorFixture('gmail', 'synthetic-receipt-stripe.html'),
  vendorFixture('gcal', 'synthetic-gcal-week-before.html'),
  vendorFixture('gcal', 'synthetic-gcal-month-november.html'),
  // Real captures (2026-10-06), read as Chrome draws them (QA-R5).
  vendorFixture('gmail', 'sent-list-1.html'),
  vendorFixture('gcal', 'week-after.html'),
  // Real receipts (2026-10-07): an opened conversation the receipt reader reads (QA third review).
  vendorFixture('gmail', 'receipt-stripe.html'),
  vendorFixture('gmail', 'receipt-uber.html'),
];
const OBSERVERS = ['gmail.sent', 'gmail.receipt', 'gcal.event'];
const EXTENSION_PAGES = ['popup.html', 'options.html', 'sidepanel.html'];
const SETTLE_MS = 3_000;

/** Every event a script could use to act on a page: pointer, mouse, keyboard, text, form, clipboard, drag. */
const INPUT_EVENTS = [
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'change',
  'select',
  'submit',
  'reset',
  'paste',
  'cut',
  'copy',
  'dragstart',
  'drop',
] as const;

interface Recorded {
  readonly type: string;
  readonly trusted: boolean;
}

async function installRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript((types: readonly string[]) => {
    const seen: { type: string; trusted: boolean }[] = [];
    Object.defineProperty(window, '__attestInputEvents', { value: seen });
    for (const type of types) {
      window.addEventListener(
        type,
        (event) => {
          seen.push({ type: event.type, trusted: event.isTrusted });
        },
        { capture: true },
      );
    }
  }, INPUT_EVENTS);
}

async function recorded(page: Page): Promise<Recorded[]> {
  const seen: unknown = await page.evaluate(() => {
    const value: unknown = Reflect.get(window, '__attestInputEvents');
    if (!Array.isArray(value)) throw new Error('input recorder not installed');
    return Array.from(value as readonly unknown[]);
  });
  if (!Array.isArray(seen)) throw new Error('input recorder returned no list');
  return seen.map((entry: unknown) => {
    const type: unknown =
      typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'type') : undefined;
    const trusted: unknown =
      typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'trusted') : undefined;
    if (typeof type !== 'string' || typeof trusted !== 'boolean') throw new Error('malformed input record');
    return { type, trusted };
  });
}

interface Session {
  readonly server: FixtureServer;
  readonly extension: LaunchedExtension;
  readonly pages: readonly { readonly url: string; readonly page: Page }[];
}

async function openFixtures(): Promise<Session> {
  const server = await startFixtureServer();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  await installRecorder(extension.context);
  await installRouteGuard(extension.context, {
    fixtureOrigin: server.origin,
    routedFixtures: routesFor(VENDOR_PAGES),
  });
  const urls = [
    ...FIXTURE_PAGES.map((fixture) => server.url(fixture)),
    ...VENDOR_PAGES.map((fixture) => fixtureUrl(fixture)),
  ];
  const pages: { url: string; page: Page }[] = [];
  for (const url of urls) {
    const page = await extension.context.newPage();
    await page.goto(url);
    pages.push({ url, page });
  }
  return { server, extension, pages };
}

/** Every observer has reported from the vendor pages: their content scripts ran there. */
async function observersRan(extension: LaunchedExtension): Promise<void> {
  const options = await extension.openExtensionPage('options.html');
  await waitForLedger(options, (ledger) =>
    OBSERVERS.every((observer) =>
      ledger.tables.adapterHealth.some((report) => report.adapterId === observer),
    ),
  );
}

async function close(session: Session): Promise<void> {
  await session.extension.close();
  await session.server.close();
}

test.describe('the extension dispatches no input events on pages', () => {
  test('fixture pages see zero input events and no navigation while the extension runs', async () => {
    test.setTimeout(2 * 60_000);
    const session = await openFixtures();
    try {
      for (const name of EXTENSION_PAGES) await session.extension.openExtensionPage(name);
      await observersRan(session.extension);
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      // Reload each page so anything that runs at document load (content scripts, later) runs again.
      for (const { page } of session.pages) await page.reload();
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      for (const { url, page } of session.pages) {
        expect(await recorded(page), url).toEqual([]);
        expect(page.url()).toBe(url);
      }
    } finally {
      await close(session);
    }
  });

  test('negative control: the recorder sees synthetic and trusted input events', async () => {
    const session = await openFixtures();
    try {
      const first = session.pages[0];
      if (first === undefined) throw new Error('no fixture page opened');
      await first.page.evaluate(() => {
        document.body.click();
        document.body.dispatchEvent(new Event('input', { bubbles: true }));
        const form = document.createElement('form');
        form.addEventListener('submit', (event) => {
          event.preventDefault();
        });
        document.body.append(form);
        form.requestSubmit();
      });
      await first.page.keyboard.press('a');
      const seen = await recorded(first.page);
      // requestSubmit() yields a *trusted* submit event: isTrusted cannot tell a script's act from the
      // user's, which is why the recorder counts every event whatever its isTrusted flag.
      expect(seen).toEqual(
        expect.arrayContaining([
          { type: 'click', trusted: false },
          { type: 'input', trusted: false },
          { type: 'submit', trusted: true },
          { type: 'keydown', trusted: true },
        ]),
      );
    } finally {
      await close(session);
    }
  });
});
