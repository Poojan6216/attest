/**
 * The Gmail and Google Calendar fixture pages (tests/fixtures/pages/{gmail,gcal}/<date>/, labelled per
 * tests/fixtures/pages/README.md), opened the way the user opens the real ones (sprint_2 2.7; Decisions [2.7]).
 *
 * Each page is served at the vendor's own address (its label's `liveUrl`, `#fragment` included) through Playwright
 * routing (./network-guard.ts `installRouteGuard`, `routedFixtures`): Chrome asks for `https://mail.google.com/…`, and
 * the route answers with the fixture's HTML from disk. Nothing reaches the network (the guard aborts every other
 * request, and the mandatory tests also run a dead proxy and NetLog). So the shipped build's own content scripts,
 * whose matches are exactly the two observer hosts, run on the fixtures, and the observers read the address they
 * read on the real page. There is no test build and no test content script (tests/e2e/built-bundle.spec.ts).
 *
 * The fixtures' times are written in America/New_York, and the Calendar observer checks the page's zone against the
 * browser's (src/observers/gcal/health.ts), so sessions that open them run the browser in that zone.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';

import type { Policy } from '../../../src/core/policy';
import { hashRowKey, project } from '../../../src/core/redact';
import type { Observation } from '../../../src/core/schema';
import { LedgerExport } from '../../../src/ledger/export';
import {
  type EventFact,
  type LabelledFixture,
  loadVendor,
  type ObservationFact,
  type ObserverVendor,
  projectArgs,
} from '../../unit/fixtures/fixture-labels';

declare const chrome: WxtBrowser;

/**
 * policy/default.json as written, for the parts these tests read (`project`'s allowlist, `candidates`' windows and
 * sources: the loader adds nothing to them). Read from disk because Playwright's loader cannot import
 * src/core/policy.ts, whose JSON import carries no import attribute.
 */
export const POLICY_DOCUMENT = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../../../policy/default.json'), 'utf8'),
) as Pick<Policy, 'allowlistedFields' | 'windows' | 'sourcesByType'>;

/** The zone every labelled observer fixture is written in. */
export const FIXTURE_TIME_ZONE = 'America/New_York';

/** The labelled fixture `file` of `vendor` (first date folder that has it). */
export function vendorFixture(vendor: ObserverVendor, file: string): LabelledFixture {
  const found = loadVendor(vendor).find((fixture) => fixture.file === file);
  if (found === undefined) throw new Error(`no ${vendor} fixture ${file}`);
  if (found.page.timeZone !== FIXTURE_TIME_ZONE)
    throw new Error(`${file} is not written in ${FIXTURE_TIME_ZONE}`);
  return found;
}

/**
 * The address a fixture is opened at: its live address plus `?fixture=<name>`, so every fixture has a request URL of
 * its own (the Gmail views share `/mail/u/0/`, and a fragment never reaches the request). The observers read the
 * host, the path and the fragment, never the query.
 */
export function fixtureUrl(fixture: LabelledFixture): string {
  const url = new URL(fixture.page.liveUrl);
  url.searchParams.set('fixture', fixture.file.replace(/\.html$/u, ''));
  return url.href;
}

/** The URL Chrome requests for a page address: the address without its fragment. */
export function requestUrl(liveUrl: string): string {
  const url = new URL(liveUrl);
  url.hash = '';
  return url.href;
}

/** Request URL → the HTML the route answers with. The guard reads it at request time. */
export type VendorRoutes = Map<string, string>;

/** Routes for `fixtures`, each answering with its file as it is on disk (its seeded secrets included). */
export function routesFor(fixtures: readonly LabelledFixture[]): VendorRoutes {
  return new Map(
    fixtures.map((fixture) => [requestUrl(fixtureUrl(fixture)), readFileSync(fixture.htmlPath, 'utf8')]),
  );
}

/**
 * Opens `fixture` at its live address, in `tab` (a new document: the tab goes to about:blank first, since a change of
 * fragment alone loads nothing) or in a new tab. Its route is set just before, so one address can serve several
 * fixtures in turn (the Calendar week before and after a change).
 */
export async function openVendorPage(
  context: BrowserContext,
  routes: VendorRoutes,
  fixture: LabelledFixture,
  tab?: Page,
): Promise<Page> {
  routes.set(requestUrl(fixtureUrl(fixture)), readFileSync(fixture.htmlPath, 'utf8'));
  const page = tab ?? (await context.newPage());
  if (tab !== undefined) await page.goto('about:blank');
  await page.goto(fixtureUrl(fixture));
  return page;
}

/**
 * The Gmail Sent page with its time cells gone, at an address of its own: a selector that broke on a real Sent list,
 * which the Gmail Sent reader reports DEGRADED (`selector.missing.time`).
 */
export function brokenSentList(): { url: string; html: string } {
  const page = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  const html = readFileSync(page.htmlPath, 'utf8').replace(
    /<span title="[^"]*" aria-label="[^"]*"><span>[^<]*<\/span><\/span>/gu,
    '',
  );
  const url = new URL(fixtureUrl(page));
  url.searchParams.set('fixture', 'broken-sent-page-1');
  return { url: url.href, html };
}

/** The ledger export, asked for from an extension page and parsed with the ledger's own schema. */
export async function readLedger(extensionPage: Page): Promise<LedgerExport> {
  const answer: unknown = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'ui.query', query: { kind: 'ledger.export' } }),
  );
  if (typeof answer !== 'object' || answer === null || Reflect.get(answer, 'ok') !== true) {
    throw new Error('the ledger export failed');
  }
  return LedgerExport.parse(Reflect.get(answer, 'data'));
}

/** Polls the ledger until `holds` is true of it, and returns that ledger; fails after `timeoutMs`. */
export async function waitForLedger(
  extensionPage: Page,
  holds: (ledger: LedgerExport) => boolean,
  timeoutMs = 30_000,
): Promise<LedgerExport> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ledger = await readLedger(extensionPage);
    if (holds(ledger)) return ledger;
    if (Date.now() > deadline) throw new Error('the ledger never reached the expected state');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * A labelled observation as the observer's `project()` stores it (its contentHash does not depend on `observedAt`).
 * A Calendar row key is the SHA-256 of `data-eventid` (src/observers/gcal/snapshot.ts).
 */
export function expectedObservation(fixture: LabelledFixture, fact: ObservationFact): Observation {
  const { source, raw, ctx } = projectArgs(fact, fixture.page.readAt);
  const rowKey = ctx.rowKey === undefined || source !== 'gcal.event' ? ctx.rowKey : hashRowKey(ctx.rowKey);
  return project(source, raw, { type: ctx.type, observedAt: ctx.observedAt, rowKey }, POLICY_DOCUMENT);
}

/** The first sighting of a labelled Calendar event: a `calendar.created` row naming its first guest, or none. */
export function sightingOf(fixture: LabelledFixture, event: EventFact): Observation {
  const [guest] = [...event.attendees].sort((a, b) => {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const fact: ObservationFact = {
    kind: 'observation',
    source: 'gcal.event',
    type: 'calendar.created',
    subjectHint: event.subjectHint,
    occurredAt: event.occurredAt,
    rowKey: event.rowKey,
    ...(guest === undefined ? {} : { counterparty: guest }),
  };
  return expectedObservation(fixture, fact);
}

/** The fields an observation of `source` may hold: its allowlist plus the derived fields every row carries. */
export function allowedFields(source: Observation['source']): ReadonlySet<string> {
  return new Set([
    ...POLICY_DOCUMENT.allowlistedFields[source],
    'id',
    'source',
    'type',
    'observedAt',
    'sightedAt',
    'rowKeyHash',
    'contentHash',
  ]);
}
