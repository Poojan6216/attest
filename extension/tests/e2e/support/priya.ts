/**
 * The paraphrased Priya claim, end to end (sprint_5 5.4; tests/e2e/intel.spec.ts, intel-off.spec.ts, no-leak.spec.ts):
 * Gmail's Sent list with a send to Priya, "Q3 deck", and one to Lee three hours ago, served at Gmail's address, and the
 * time format Gmail writes in a row's title. A claim "Quarterly deck" to Priya five minutes after her send has a floor of
 * 0.8462: PARTIAL, still in its grace, the one case the model is asked about. Every value is invented.
 */
import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';

import type { LedgerExport } from '../../../src/ledger/export';
import { demoSentPage } from './demo';
import type { LaunchedExtension } from './extension';
import { clockAt, pasteActivity } from './paste';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  requestUrl,
  type VendorRoutes,
  vendorFixture,
  waitForLedger,
} from './vendor-pages';

export const MINUTE_MS = 60_000;

/** A Sent row's time as Gmail's title writes it: "Sat, Oct 10, 2026, 2:55 PM" (./support/demo.ts). */
export function gmailTitle(ms: number): string {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: FIXTURE_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return format.format(new Date(ms)).replace(/\s/gu, ' ');
}

/** The claim of `ledger` for `counterparty`, and its receipt. */
export function claimOf(ledger: LedgerExport, counterparty: string) {
  const claim = ledger.tables.claims.find((row) => row.counterparty === counterparty);
  const receipt = ledger.tables.receipts.find(
    (row) => row.claimId !== undefined && row.claimId === claim?.id,
  );
  return { claim, receipt };
}

/** Opens Gmail's Sent head: the send to Priya at `priyaMs`, and Lee's three hours before `nowMs`. */
export async function openSent(
  extension: LaunchedExtension,
  routes: VendorRoutes,
  ledgerPage: Page,
  nowMs: number,
  priyaMs: number,
) {
  const sent = vendorFixture('gmail', 'synthetic-sent-page-1.html');
  const rows = [
    {
      name: 'Priya',
      email: 'priya@company.example',
      subject: 'Q3 deck',
      snippet: 'Here it is.',
      at: priyaMs,
    },
    {
      name: 'Lee',
      email: 'lee@company.example',
      subject: 'Lunch',
      snippet: 'Noon works.',
      at: nowMs - 180 * MINUTE_MS,
    },
  ].map(({ at, ...row }, index) => ({
    ...row,
    title: gmailTitle(at),
    messageId: `1a1020a0b0c0e00${String(index + 1)}`,
  }));
  routes.set(requestUrl(fixtureUrl(sent)), demoSentPage(readFileSync(sent.htmlPath, 'utf8'), rows));
  // The minute the page opens: a pass's coverage synced since then is this page's (or a later pass's).
  const openedMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const gmail = await extension.context.newPage();
  await gmail.goto(fixtureUrl(sent));
  // Both sends stored, by the address Gmail's observer reads, whatever other rows the ledger already holds: the
  // secret-seed session opens its own Gmail pages first (no-leak.spec.ts).
  const sentTo = (read: LedgerExport, email: string): boolean =>
    read.tables.observations.some((row) => row.source === 'gmail.sent' && row.counterparty === email);
  await waitForLedger(
    ledgerPage,
    (read) =>
      rows.every((row) => sentTo(read, row.email)) &&
      read.tables.coverageIntervals.some(
        (entry) => entry.source === 'gmail.sent' && Date.parse(entry.lastSyncAt) >= openedMs,
      ),
  );
}

/**
 * Asks the model about the Priya claim once (header): the Sent list opened, the claim pasted five minutes after her
 * send, and the ledger read until the model's answer is stored. The person's own key must be on, and the vendor
 * answered by a stand-in (./model-vendor.ts).
 */
export async function askAboutPriya(
  extension: LaunchedExtension,
  routes: VendorRoutes,
  ledgerPage: Page,
): Promise<void> {
  const nowMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const priyaMs = nowMs - 5 * MINUTE_MS;
  await openSent(extension, routes, ledgerPage, nowMs, priyaMs);
  const panel = await extension.openExtensionPage('sidepanel.html');
  const log = ['Sent email "Quarterly deck" to Priya', clockAt(priyaMs, FIXTURE_TIME_ZONE)].join('\n');
  expect(await pasteActivity(panel, 'Muse', log)).toBe('Imported 1 claim.');
  await panel.close();
  await waitForLedger(
    ledgerPage,
    (read) => read.tables.modelAnswers.some((row) => row.scores !== undefined),
    60_000,
  );
}
