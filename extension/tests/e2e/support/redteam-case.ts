/**
 * One red-team case through the real pipeline (sprint_6 6.0; agents/red_team.md): the built extension in a browser of
 * its own, the case's pages served at their Gmail or Calendar addresses and read by Attest's shipped readers, the
 * agent's log pasted in the side panel as a person pastes it, and the ledger read once grading has settled. Every
 * request that is neither a served page nor the fixture server is blocked (./network-guard.ts), and the browser runs
 * behind the dead proxy (./extension.ts), so an attack page reaches nothing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import type { LedgerExport } from '../../../src/ledger/export';
import { AGENT_NAMES } from '../../../src/ui/labels';
import type { AttackCase, AttackPage, Strategy } from '../../redteam/attack-schema';
import { demoSentPage } from './demo';
import { type LaunchedExtension, launchExtension } from './extension';
import { installRouteGuard } from './network-guard';
import { clockAt } from './paste';
import { gmailTitle, MINUTE_MS } from './priya';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  readLedger,
  requestUrl,
  type VendorRoutes,
  vendorFixture,
} from './vendor-pages';

/** How long a page may take to be read, and grading to settle, before the case fails loud (Hard Rule 12). */
const READ_TIMEOUT_MS = 20_000;
const SETTLE_TIMEOUT_MS = 60_000;
/** Grading has settled when the receipts read the same this many polls in a row. */
const QUIET_POLLS = 4;
const POLL_MS = 500;

/** The readers that report on each host's pages (src/observers). */
const READERS: Readonly<Record<string, readonly string[]>> = {
  'mail.google.com': ['gmail.sent', 'gmail.receipt'],
  'calendar.google.com': ['gcal.event'],
};

const SENT_HEAD = vendorFixture('gmail', 'synthetic-sent-page-1.html');

/** The address `page` is served at, and its HTML. */
function served(strategy: Strategy, page: AttackPage, nowMs: number): { url: string; html: string } {
  if (page.kind === 'file')
    return { url: page.url, html: readFileSync(path.join(strategy.dir, page.file), 'utf8') };
  const rows = page.rows.map(({ minutesAgo, ...row }, index) => ({
    ...row,
    title: gmailTitle(nowMs - minutesAgo * MINUTE_MS),
    messageId: `1a1020a0b0c0f${String(index + 100).padStart(3, '0')}`,
  }));
  return { url: fixtureUrl(SENT_HEAD), html: demoSentPage(readFileSync(SENT_HEAD.htmlPath, 'utf8'), rows) };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the ledger until `holds` is true of it; throws `what` after `timeoutMs`. */
async function until(
  ledgerPage: Page,
  holds: (ledger: LedgerExport) => boolean,
  timeoutMs: number,
  what: string,
): Promise<LedgerExport> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ledger = await readLedger(ledgerPage);
    if (holds(ledger)) return ledger;
    if (Date.now() > deadline) throw new Error(`red team: ${what}`);
    await sleep(POLL_MS);
  }
}

/** Opens `page` in a tab and waits until a reader of its host has reported on it since it opened. */
async function openPage(
  extension: LaunchedExtension,
  routes: VendorRoutes,
  ledgerPage: Page,
  { url, html }: { url: string; html: string },
): Promise<void> {
  routes.set(requestUrl(url), html);
  const readers = READERS[new URL(url).hostname] ?? [];
  const openedMs = Math.floor(Date.now() / 1000) * 1000;
  const tab = await extension.context.newPage();
  await tab.goto(url);
  await until(
    ledgerPage,
    (ledger) =>
      ledger.tables.adapterHealth.some(
        (report) => readers.includes(report.adapterId) && Date.parse(report.checkedAt) >= openedMs,
      ),
    READ_TIMEOUT_MS,
    `no reader reported on ${url}`,
  );
}

/** Pastes `attackCase`'s log in the side panel, each line followed by its time, and imports what it finds. */
async function pasteLog(extension: LaunchedExtension, attackCase: AttackCase, nowMs: number): Promise<void> {
  const { log } = attackCase;
  if (log === undefined) return;
  const text = log.lines
    .flatMap(({ text: line, minutesAgo }) => [
      line,
      clockAt(nowMs - minutesAgo * MINUTE_MS, FIXTURE_TIME_ZONE),
    ])
    .join('\n');
  const panel = await extension.openExtensionPage('sidepanel.html');
  await panel.getByRole('button', { name: 'Add agent activity' }).click();
  await panel.getByRole('radio', { name: AGENT_NAMES[log.agent] }).check();
  await panel.getByLabel('Activity log').fill(text);
  await panel.getByRole('button', { name: 'Preview' }).click();
  await panel.getByRole('button', { name: /^Import \d+ claims?$/u }).click();
  await panel
    .getByRole('status')
    .filter({ hasText: /^(?:Imported \d+|Attest already had)/u })
    .waitFor({ timeout: READ_TIMEOUT_MS });
}

/** The receipts' grades and states, as one comparable line. */
const receiptsOf = (ledger: LedgerExport): string =>
  JSON.stringify(
    ledger.tables.receipts.map((receipt) => [receipt.id, receipt.grade, receipt.state, receipt.supersededBy]),
  );

/** The ledger once every claim has a receipt and the receipts have stopped changing. */
async function settled(ledgerPage: Page): Promise<LedgerExport> {
  let last = '';
  let quiet = 0;
  return until(
    ledgerPage,
    (ledger) => {
      const graded = ledger.tables.claims.every((claim) =>
        ledger.tables.receipts.some((receipt) => receipt.claimId === claim.id),
      );
      const now = receiptsOf(ledger);
      quiet = now === last ? quiet + 1 : 0;
      last = now;
      return graded && quiet >= QUIET_POLLS;
    },
    SETTLE_TIMEOUT_MS,
    'grading never settled',
  );
}

/** Runs `attackCase` of `strategy` (header) and returns the ledger it left. `fixtureOrigin`: the fixture server's. */
export async function runAttackCase(
  strategy: Strategy,
  attackCase: AttackCase,
  fixtureOrigin: string,
): Promise<LedgerExport> {
  const nowMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const routes: VendorRoutes = new Map();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    await installRouteGuard(extension.context, { fixtureOrigin, routedFixtures: routes });
    const ledgerPage = await extension.openExtensionPage('options.html');
    for (const page of attackCase.pages)
      await openPage(extension, routes, ledgerPage, served(strategy, page, nowMs));
    await pasteLog(extension, attackCase, nowMs);
    return await settled(ledgerPage);
  } finally {
    await extension.close();
  }
}
