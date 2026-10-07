/**
 * The labelled Gmail fixtures as the receipt observer sees them (sprint_2 2.3), shared by the receipt tests and
 * bench/observers/receipts.ts. Each page is parsed by happy-dom in an inert window (no scripts, no resource
 * loading, every request refused) whose address is the page fact's `liveUrl`, so the observer reads the same
 * `#inbox/<id>` fragment it reads on Gmail (tests/fixtures/pages/README.md). Times use the page fact's `readAt` as
 * the pass instant and its IANA zone for offsets, whatever zone the machine runs in.
 *
 * Expected observations are the labelled facts after `redact.project()` under the shipped policy: the observer
 * must produce exactly those (Hard Rules 2, 12).
 */
import { readFileSync } from 'node:fs';

import { Window } from 'happy-dom';

import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { accountHashOf } from '../../../../src/observers/account';
import { project } from '../../../../src/core/redact';
import { IsoTs, type Observation } from '../../../../src/core/schema';
import { type CoverageFacts, type PassPlan, planPass } from '../../../../src/observers/plan';
import type { ExtractContext, HealthCheck } from '../../../../src/observers/types';
import {
  type MessageVerdict,
  receiptObserver,
  receiptVerdicts,
} from '../../../../src/observers/gmail/receipts';
import { zoneOffset } from '../../fixtures/fixture-page-read';
import { type LabelledFixture, loadVendor, projectArgs } from '../../fixtures/fixture-labels';

/** Every labelled Gmail fixture, across date folders. */
export function gmailFixtures(): LabelledFixture[] {
  return loadVendor('gmail');
}

function inertWindow(url: string): Window {
  return new Window({
    url,
    settings: {
      enableJavaScriptEvaluation: false,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
        disableFallbackToSetURL: true,
      },
    },
  });
}

/**
 * Parses `html` at `url` and hands the page to `read` as the DOM `Document` the observer is typed against
 * (happy-dom implements it; its own types are a different declaration of the same interface). The window is
 * closed afterwards.
 */
export function withPage<T>(html: string, url: string, read: (doc: Document) => T): T {
  const window = inertWindow(url);
  try {
    const parsed: unknown = new window.DOMParser().parseFromString(html, 'text/html');
    return read(parsed as Document);
  } finally {
    void window.happyDOM.close();
  }
}

/** The fixture's page at its live URL (`withUrl`), or at a blank address (DOM signals only). */
export function withFixture<T>(f: LabelledFixture, read: (doc: Document) => T, withUrl = true): T {
  return withPage(readFileSync(f.htmlPath, 'utf8'), withUrl ? f.page.liveUrl : 'about:blank', read);
}

/** The labelled gmail.receipt observations of a fixture. */
export const receiptFacts = (f: LabelledFixture): LabelledFixture['observations'] =>
  f.observations.filter((o) => o.source === 'gmail.receipt');

/** The positives: fixtures with a labelled receipt, the pages field accuracy is measured on. */
export const receiptPositives = (fixtures: readonly LabelledFixture[]): LabelledFixture[] =>
  fixtures.filter((f) => receiptFacts(f).length > 0);

/**
 * The negatives: opened messages with no labelled receipt, the pages that must stay unparsed: from the Inbox, or
 * opened from a search, which selects no folder (the real captures of 2026-10-06). The account's own mail in Sent
 * is not one: no parser reads it.
 */
export const receiptNegatives = (fixtures: readonly LabelledFixture[]): LabelledFixture[] =>
  fixtures.filter(
    (f) => f.page.view === 'gmail.message' && f.page.folder !== 'sent' && receiptFacts(f).length === 0,
  );

/**
 * The fixtures the receipt numbers are scored on (QA-V3): the positives (field accuracy) and the negatives (the
 * false-positive gate). The bench's real-capture count is taken over these, never over every Gmail page.
 */
export const receiptScoredFixtures = (fixtures: readonly LabelledFixture[]): LabelledFixture[] => [
  ...receiptPositives(fixtures),
  ...receiptNegatives(fixtures),
];

/** The pass context of a fixture: its read instant and its zone. */
export function contextOf(f: LabelledFixture): ExtractContext {
  return { observedAt: IsoTs.parse(f.page.readAt), offsetAt: zoneOffset(f.page.timeZone) };
}

/** The labelled receipt facts, projected as the ledger would store them. */
export function expectedReceipts(f: LabelledFixture): Observation[] {
  return f.observations
    .filter((o) => o.source === 'gmail.receipt')
    .map((o) => {
      const { source, raw, ctx } = projectArgs(o, f.page.readAt);
      return project(source, raw, ctx, DEFAULT_POLICY);
    });
}

/** The labelled gmail.receipt coverage, as the pass plan holds it (one instant per parsed receipt, sprint_2 2.7). */
export function expectedReceiptCoverage(f: LabelledFixture): CoverageFacts[] {
  return f.coverage
    .filter((c) => c.source === 'gmail.receipt')
    .map((c) => {
      const accountHash = accountHashOf(c.account);
      if (accountHash === null || c.windowEnd === 'lastSyncAt')
        throw new Error(`${f.file}: bad coverage label`);
      return {
        windowStart: IsoTs.parse(c.windowStart),
        windowEnd: IsoTs.parse(c.windowEnd),
        accountHash,
      };
    });
}

/** The coverage a plan asserts: its windows when OK, none otherwise. */
export function planCoverage(plan: PassPlan): readonly CoverageFacts[] {
  return plan.status === 'OK' ? plan.coverage : [];
}

/** What the receipt observer does with one fixture: its health, its pass plan and each message's verdict. */
export interface ReceiptRun {
  readonly health: HealthCheck;
  readonly plan: PassPlan;
  readonly verdicts: readonly MessageVerdict[];
}

export function runReceipts(f: LabelledFixture, withUrl = true): ReceiptRun {
  return withFixture(
    f,
    (doc) => ({
      health: receiptObserver.health(doc),
      plan: planPass({ observer: receiptObserver, doc, ctx: contextOf(f), policy: DEFAULT_POLICY }),
      verdicts: receiptVerdicts(doc),
    }),
    withUrl,
  );
}

/** The labelled gmail.receipt health of a fixture, if it has one. */
export function receiptHealthLabel(f: LabelledFixture): LabelledFixture['health'][number] | undefined {
  return f.health.find((h) => h.observer === 'gmail.receipt');
}
