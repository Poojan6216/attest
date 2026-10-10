/**
 * Sprint 5.4 Done-when, end to end on the built extension (src/background/intel.ts; docs/grading.md §5.4), and the
 * network half of 5.3's (the provider host is contacted only with the person's own key on, with exactly the
 * allowlisted input). The person saves an invented Anthropic key and turns it on; Anthropic's endpoint is answered by
 * a stand-in that scores every candidate 1 (./support/model-vendor.ts). Gmail's Sent list shows a send to Priya,
 * "Q3 deck", five minutes ago, and one to Lee three hours ago. The person pastes Muse's log: an email "Quarterly deck"
 * to Priya five minutes ago, a paraphrase whose floor is 0.8462 (PARTIAL, still in its grace), and an email "Budget"
 * to Sam two hours ago, which nothing matches (NOT_FOUND, FINAL). Then:
 *  - the model is asked once, about the PARTIAL claim alone, and its receipt becomes VERIFIED with the model's score
 *    beside the floor; the NOT_FOUND is unchanged, and its claim is never sent;
 *  - the one request carries exactly the Anthropic request around the allowlisted facts of the claim and its one
 *    candidate, the key only in its header;
 *  - with the key turned off, the next batch grades the same claim by the rules alone: PARTIAL again, at its floor;
 *  - NetLog and the route guard see no host but Anthropic's (the allowlist the mandatory test holds empty while the
 *    key is off grows by exactly that host while it is on);
 *  - replay reproduces every receipt from both exports, the raised one with its stored scores (Hard Rule 4).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { BYO_VENDORS } from '../../src/config';
import { buildInput } from '../../src/intel/input';
import { dataBlock, SYSTEM_PROMPT } from '../../src/intel/prompt';
import type { LedgerExport } from '../../src/ledger/export';
import { startFixtureServer } from '../tools/serve-fixtures';
import { saveKey } from './support/byo-key';
import { demoSentPage } from './support/demo';
import { launchExtension, type LaunchedExtension } from './support/extension';
import { stubAnthropic, type VendorRequest } from './support/model-vendor';
import { netLogPathFor, readNetLogRequests } from './support/netlog';
import { analyse, guardArgs, installRouteGuard, type NetworkReport } from './support/network-guard';
import { clockAt, pasteActivity } from './support/paste';
import { replayExport } from './support/replay';
import {
  FIXTURE_TIME_ZONE,
  fixtureUrl,
  requestUrl,
  type VendorRoutes,
  vendorFixture,
  waitForLedger,
} from './support/vendor-pages';

/** An invented key in the shape of Anthropic's (src/bus/page-commands.ts ByoKey). */
const INVENTED_KEY = 'sk-ant-invented-e2e-4f8Kq2Lm7Np3Rs9T';
const MINUTE_MS = 60_000;

/** A Sent row's time as Gmail's title writes it: "Sat, Oct 10, 2026, 2:55 PM" (./support/demo.ts). */
function gmailTitle(ms: number): string {
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
function claimOf(ledger: LedgerExport, counterparty: string) {
  const claim = ledger.tables.claims.find((row) => row.counterparty === counterparty);
  const receipt = ledger.tables.receipts.find(
    (row) => row.claimId !== undefined && row.claimId === claim?.id,
  );
  return { claim, receipt };
}

/** Turns the person's own key off in the options page's Model section, as a person would. */
async function turnKeyOff(extension: LaunchedExtension): Promise<void> {
  const options = await extension.openExtensionPage('options.html');
  const byo = options.getByRole('group', { name: 'Your own model key' });
  await byo.getByRole('button', { name: 'Turn off my own key' }).click();
  await expect(byo.getByRole('status')).toContainText('Your own key is off.');
  await options.close();
}

/** Opens Gmail's Sent head: the send to Priya at `priyaMs`, and Lee's three hours before `nowMs`. */
async function openSent(
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
  const gmail = await extension.context.newPage();
  await gmail.goto(fixtureUrl(sent));
  await waitForLedger(
    ledgerPage,
    (read) =>
      read.tables.observations.length === 2 &&
      read.tables.coverageIntervals.some((entry) => entry.source === 'gmail.sent'),
  );
}

interface Session {
  /** The ledger once the model's answer raised the Priya claim. */
  readonly raised: LedgerExport;
  /** The ledger once a batch graded it again with the key off. */
  readonly floor: LedgerExport;
  readonly asked: readonly VendorRequest[];
  readonly report: NetworkReport;
  readonly guarded: readonly unknown[];
}

/** The browser part (header), NetLog on, behind the route guard and the dead proxy; the browser closed after. */
async function runSession(): Promise<Session> {
  const server = await startFixtureServer();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'attest-netlog-intel-'));
  const routes: VendorRoutes = new Map();
  const extension = await launchExtension({
    extraArgs: (attempt) => guardArgs(netLogPathFor(dir, attempt)),
    timezoneId: FIXTURE_TIME_ZONE,
  });
  try {
    const guarded = await installRouteGuard(extension.context, {
      fixtureOrigin: server.origin,
      routedFixtures: routes,
    });
    const asked = await stubAnthropic(extension.context);
    await saveKey(extension, INVENTED_KEY);
    const ledgerPage = await extension.openExtensionPage('options.html');
    const nowMs = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
    const priyaMs = nowMs - 5 * MINUTE_MS;
    await openSent(extension, routes, ledgerPage, nowMs, priyaMs);
    const log = [
      ...['Sent email "Quarterly deck" to Priya', clockAt(priyaMs, FIXTURE_TIME_ZONE)],
      ...['Sent email "Budget" to Sam', clockAt(nowMs - 120 * MINUTE_MS, FIXTURE_TIME_ZONE)],
    ];
    const panel = await extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(panel, 'Muse', log.join('\n'))).toBe('Imported 2 claims.');
    const isPriya = (grade: string) => (read: LedgerExport) =>
      claimOf(read, 'Priya').receipt?.grade === grade;
    const raised = await waitForLedger(ledgerPage, isPriya('VERIFIED'), 60_000);
    // The key turned off, the next batch (after another paste) grades the same claim by the rules alone.
    await turnKeyOff(extension);
    const more = ['Unsubscribed you from the newsletter', clockAt(nowMs - MINUTE_MS, FIXTURE_TIME_ZONE)];
    expect(await pasteActivity(panel, 'Muse', more.join('\n'))).toBe('Imported 1 claim.');
    const floor = await waitForLedger(ledgerPage, isPriya('PARTIAL'));
    await extension.close();
    const report = analyse(readNetLogRequests(dir), guarded, {
      fixtureOrigin: server.origin,
      allowlist: [BYO_VENDORS.anthropic.host],
      routedFixtureUrls: new Set(routes.keys()),
    });
    return { raised, floor, asked, report, guarded };
  } finally {
    await extension.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the model lifts a paraphrased PARTIAL to VERIFIED, leaves a NOT_FOUND alone, and only its vendor hears of it', async () => {
  test.setTimeout(3 * 60_000);
  const { raised, floor, asked, report, guarded } = await runSession();

  // The Priya claim: VERIFIED with the model's score beside its floor, still in grace; PARTIAL by the rules alone.
  const priya = claimOf(raised, 'Priya');
  const observation = raised.tables.observations.find((row) => row.counterparty === 'priya@company.example');
  if (priya.claim === undefined || observation === undefined)
    throw new Error('the Priya claim or its send is missing');
  expect(priya.receipt).toMatchObject({
    grade: 'VERIFIED',
    state: 'PENDING',
    observationIds: [observation.id],
  });
  // 0.85 · 0.8462 + 0.15 · 1 (§5.4).
  expect(priya.receipt?.signals).toMatchObject({ modelScore: 1, score: 0.8692 });
  const rulesOnly = claimOf(floor, 'Priya').receipt;
  expect(rulesOnly).toMatchObject({ grade: 'PARTIAL', state: 'PENDING', observationIds: [observation.id] });
  expect(rulesOnly?.signals.score).toBe(0.8462);
  expect(rulesOnly?.signals).not.toHaveProperty('modelScore');
  const scores = [{ observationId: observation.id, score: 10_000 }];
  expect(raised.tables.modelAnswers).toEqual([
    expect.objectContaining({ claimId: priya.claim.id, provider: 'byo', scores }),
  ]);
  // The Sam claim: NOT_FOUND, FINAL, never asked about.
  expect(claimOf(raised, 'Sam').receipt).toMatchObject({
    grade: 'NOT_FOUND',
    state: 'FINAL',
    observationIds: [],
  });

  // Exactly one call, with exactly the allowlisted facts of the claim and its one candidate; the key in its header only.
  expect(asked.map(({ method }) => method)).toEqual(['POST']);
  const [post] = asked;
  expect(JSON.parse(post?.body ?? '')).toEqual({
    model: BYO_VENDORS.anthropic.model,
    max_tokens: 1_024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: dataBlock(buildInput(priya.claim, [observation])) }],
  });
  expect(post?.headers).toMatchObject({ 'x-api-key': INVENTED_KEY, 'anthropic-version': '2023-06-01' });
  for (const request of asked) {
    expect(request.body).not.toContain(INVENTED_KEY);
    for (const word of ['Budget', 'Sam', 'Lunch', 'lee@', 'newsletter'])
      expect(request.body).not.toContain(word);
  }

  // Nothing else left the browser: every request the extension or a page made went to Anthropic's host, or nowhere.
  expect(report.violations).toEqual([]);
  expect(report.unknownBrowserHosts).toEqual([]);
  expect(guarded).toEqual([]);

  // Every receipt is proven again from each export, the raised one with the scores its inputs hold (Hard Rule 4).
  for (const ledger of [raised, floor]) expect(replayExport(ledger)).toMatch(/^ {2}mismatched {2}0$/mu);
});
