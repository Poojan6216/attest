/**
 * One red-team case through the real pipeline (sprint_6 6.0; agents/red_team.md): the built extension in a browser of
 * its own, the case's pages served at their Gmail or Calendar addresses and read by Attest's shipped readers, the
 * agent's log pasted in the side panel as a person pastes it, and the ledger read once grading has settled. Every
 * request that is neither a served page nor the fixture server is blocked (./network-guard.ts), and the browser runs
 * behind the dead proxy (./extension.ts), so an attack page reaches nothing.
 */
import type { Page } from '@playwright/test';

import type { LedgerExport } from '../../../src/ledger/export';
import { AGENT_NAMES } from '../../../src/ui/labels';
import type { AttackCase, AttackLog, Strategy } from '../../redteam/attack-schema';
import { type LaunchedExtension, launchExtension } from './extension';
import { stubAnthropic, type VendorRequest } from './model-vendor';
import { installRouteGuard } from './network-guard';
import { clockAt } from './paste';
import { MINUTE_MS } from './priya';
import { served } from './redteam-pages';
import { FIXTURE_TIME_ZONE, readLedger, requestUrl, type VendorRoutes } from './vendor-pages';

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

/** `log` as the agent's activity view writes it: each line, then its time (in the browser's zone, or in UTC, saying so). */
function logText(log: AttackLog, nowMs: number): string {
  return log.lines
    .flatMap(({ text, minutesAgo, at: fixed, clock }) => {
      const at = fixed === undefined ? nowMs - (minutesAgo ?? 0) * MINUTE_MS : Date.parse(fixed);
      return [text, clock === 'utc' ? `${clockAt(at, 'UTC')} UTC` : clockAt(at, FIXTURE_TIME_ZONE)];
    })
    .join('\n');
}

/**
 * Pastes `log` in the side panel as a person does and imports what the preview finds. A preview with nothing to import
 * (every line refused, each with its reason) imports nothing: the case's ledger then holds no claim from it.
 */
async function pasteLog(extension: LaunchedExtension, log: AttackLog, nowMs: number): Promise<void> {
  const panel = await extension.openExtensionPage('sidepanel.html');
  await panel.getByRole('button', { name: 'Add agent activity' }).click();
  await panel.getByRole('radio', { name: AGENT_NAMES[log.agent] }).check();
  await panel.getByLabel('Activity log').fill(logText(log, nowMs));
  await panel.getByRole('button', { name: 'Preview' }).click();
  const importButton = panel.getByRole('button', { name: /^Import \d+ claims?$/u });
  const nothing = panel.getByText(/^Nothing to import from /u);
  await importButton.or(nothing).first().waitFor({ timeout: READ_TIMEOUT_MS });
  if (await nothing.isVisible()) {
    await panel.close();
    return;
  }
  await importButton.click();
  await panel
    .getByRole('status')
    .filter({ hasText: /^(?:Imported \d+|Attest already had)/u })
    .waitFor({ timeout: READ_TIMEOUT_MS });
  await panel.close();
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

/** An invented key of Anthropic's form, saved and turned on in the options page as a person does (sprint_5 5.3). */
const INVENTED_KEY = 'sk-ant-redteam-invented-7Kq2Lm9Np3Rs';

async function turnOnOwnKey(extension: LaunchedExtension): Promise<void> {
  const options = await extension.openExtensionPage('options.html');
  const byo = options.getByRole('group', { name: 'Your own model key' });
  await byo.getByLabel('Your key').fill(INVENTED_KEY);
  await byo.getByRole('button', { name: 'Save key' }).click();
  await byo.getByRole('status').filter({ hasText: 'Your Anthropic key is saved.' }).waitFor();
  await byo.getByRole('button', { name: 'Turn on my own key' }).click();
  await byo.getByRole('status').filter({ hasText: 'Your own key is on.' }).waitFor();
  await options.close();
}

/** The bodies of the requests the model's stand-in received, once it has received `asked` of them or a while passed. */
async function modelBodies(requests: readonly VendorRequest[], asked: number): Promise<string[]> {
  const deadline = Date.now() + READ_TIMEOUT_MS;
  const posts = () => requests.filter((request) => request.method === 'POST');
  while (posts().length < asked && Date.now() < deadline) await sleep(POLL_MS);
  return posts().map((request) => request.body);
}

/**
 * Runs `attackCase` of `strategy` (header) and returns the ledger it left, with the bodies the model's stand-in
 * received when the case turns a model on. `fixtureOrigin`: the fixture server's.
 */
export async function runAttackCase(
  strategy: Strategy,
  attackCase: AttackCase,
  fixtureOrigin: string,
): Promise<LedgerExport & { readonly modelRequests?: readonly string[] }> {
  const nowMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
  const routes: VendorRoutes = new Map();
  const extension = await launchExtension({ timezoneId: FIXTURE_TIME_ZONE });
  try {
    await installRouteGuard(extension.context, { fixtureOrigin, routedFixtures: routes });
    // After the guard, so the stand-in answers first (./model-vendor.ts).
    const requests =
      attackCase.model === undefined ? null : await stubAnthropic(extension.context, attackCase.model.score);
    if (requests !== null) await turnOnOwnKey(extension);
    const ledgerPage = await extension.openExtensionPage('options.html');
    for (const page of attackCase.pages)
      await openPage(extension, routes, ledgerPage, served(strategy, page, nowMs));
    for (const log of attackCase.logs ?? []) await pasteLog(extension, log, nowMs);
    if (requests === null) return await settled(ledgerPage);
    const modelRequests = await modelBodies(requests, attackCase.modelInput?.asked ?? 1);
    return { ...(await settled(ledgerPage)), modelRequests };
  } finally {
    await extension.close();
  }
}
