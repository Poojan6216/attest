/**
 * The build_spec §2 demo's flow on the built extension (sprint_3 3.16; shared by tests/e2e/demo-paste.spec.ts and
 * tests/e2e/alerts.spec.ts): the demo's Gmail Sent head and Calendar week opened and read, and the away interval of
 * 6 October stored, so that pasting Muse's log (./demo.ts DEMO_LOG) grades VERIFIED, NOT_FOUND and UNASKED, all FINAL.
 */
import { putRawRows } from './raw-ledger';
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { DEMO_AWAY, DEMO_SENT, demoSentPage, emptyWeek } from './demo';
import type { VendorSession } from './session';
import { fixtureUrl, requestUrl, vendorFixture, waitForLedger } from './vendor-pages';

/** Opens the demo's Gmail Sent head and Calendar week, and waits until each pass is stored with its coverage. */
export async function openDemoPages(session: VendorSession): Promise<readonly Page[]> {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  session.routes.set(requestUrl(fixtureUrl(sent)), demoSentPage(readFileSync(sent.htmlPath, 'utf8')));
  const gmail = await session.extension.context.newPage();
  await gmail.goto(fixtureUrl(sent));
  await waitForLedger(
    session.ledgerPage,
    (ledger) =>
      DEMO_SENT.every((row) => ledger.tables.observations.some((o) => o.counterparty === row.email)) &&
      ledger.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
  );
  const week = vendorFixture('gcal', 'synthetic-gcal-week-two-calendars.html');
  session.routes.set(requestUrl(fixtureUrl(week)), emptyWeek(readFileSync(week.htmlPath, 'utf8')));
  const calendar = await session.extension.context.newPage();
  await calendar.goto(fixtureUrl(week));
  await waitForLedger(session.ledgerPage, (ledger) =>
    ledger.tables.coverageIntervals.some(
      (entry) => entry.source === 'gcal.event' && entry.allCalendars === true,
    ),
  );
  return [gmail, calendar];
}

/** Stores the away interval of 6 October in the extension's own IndexedDB, from its service worker (DEMO_AWAY). */
export async function writeAway(session: VendorSession): Promise<void> {
  await putRawRows(await session.extension.serviceWorker(), 'activity', [DEMO_AWAY]);
}
