/// <reference lib="dom" />
/**
 * Receipt parser bench (sprint_2 2.3 Done-when; agents/adapter_engineer.md rule 10; Hard Rule 12: every accuracy
 * figure traces to this command and its committed result file).
 *
 * Runs the Gmail receipt observer (extension/src/observers/gmail/receipts) over every labelled Gmail fixture, each
 * parsed by happy-dom in an inert window at the page's live address, read at the page fact's `readAt` in its IANA
 * zone (extension/tests/unit/observers/receipts/receipt-fixtures.ts, the helper the unit tests use). Expected
 * observations are the labelled facts after `redact.project()`. It reports, per parser, the labelled fixtures, how
 * many the observer reproduced exactly (the labelled parser claims the message, every projected field and hash
 * equal) and the field accuracy over type, merchant, amountCents, currency, subjectHint and occurredAt; and overall,
 * the negatives left unparsed, the list views left neutral (health OK, nothing read), the pages whose asserted
 * coverage is exactly the labelled one (the instant of each parsed receipt and nothing else, sprint_2 2.7) and the
 * pages whose health matched its label.
 *
 * Gate `receiptParsersGatePassed`: all eight parsers (stripe, amazon, marketplace, opentable, instacart, uber,
 * shopify, generic) reproduce every labelled fixture exactly, the generic parser has at least 3 positives and the
 * corpus at least 3 negatives, every negative stays unparsed, every list view is neutral, every page asserts
 * exactly its labelled coverage (a platform receipt's instant; none for a generic receipt, SEC-6, or where nothing
 * was parsed), and every labelled health matches.
 *
 * Corpus honesty (Hard Rule 12; QA-4, QA-V3): `receiptRealFixtures` counts the real captures among the pages the
 * numbers are scored on (the positives and the negatives, receipt-fixtures.ts `receiptScoredFixtures`): the
 * founder's first real captures (2026-10-06) add four (Stripe, Instacart and Uber receipts, and an Amazon shipping
 * notice); every other page is synthetic.
 *
 * The DOM lib reference above types the extension code this bench runs (it takes a DOM `Document`); nothing here
 * touches a real browser or the network.
 */
import type { MetricValue } from '../results';

import type { Observation } from '../../extension/src/core/schema';
import type { LabelledFixture } from '../../extension/tests/unit/fixtures/fixture-labels';
import {
  expectedReceiptCoverage,
  expectedReceipts,
  gmailFixtures,
  planCoverage,
  receiptFacts,
  receiptHealthLabel,
  receiptNegatives,
  type ReceiptRun,
  receiptScoredFixtures,
  runReceipts,
} from '../../extension/tests/unit/observers/receipts/receipt-fixtures';

export const RECEIPT_PARSERS = [
  'stripe',
  'amazon',
  'marketplace',
  'opentable',
  'instacart',
  'uber',
  'shopify',
  'generic',
] as const;
type Parser = (typeof RECEIPT_PARSERS)[number];

const FIELDS = ['type', 'merchant', 'amountCents', 'currency', 'subjectHint', 'occurredAt'] as const;
const MIN_GENERIC_POSITIVES = 3;
const MIN_NEGATIVES = 3;

interface ParserTally {
  fixtures: number;
  exact: number;
  fieldsRight: number;
  fieldsTotal: number;
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Fields of `expected` that the observation with its row key holds equally (none when it is missing). */
function fieldsRight(expected: Observation, actual: readonly Observation[]): number {
  const twin = actual.find((o) => o.rowKeyHash === expected.rowKeyHash);
  return twin === undefined ? 0 : FIELDS.filter((field) => twin[field] === expected[field]).length;
}

/** Scores one positive fixture into its parser's tally. */
function scorePositive(f: LabelledFixture, run: ReceiptRun, tallies: Map<Parser, ParserTally>): void {
  const expected = expectedReceipts(f);
  const claimed = run.verdicts.filter((v) => v.verdict.kind === 'receipt').map((v) => [v.key, v.parser]);
  const labelled = receiptFacts(f).map((o) => [o.rowKey, o.parser]);
  const exact =
    JSON.stringify(run.plan.observations) === JSON.stringify(expected) &&
    JSON.stringify(claimed) === JSON.stringify(labelled);
  for (const parser of RECEIPT_PARSERS.filter((p) => receiptFacts(f).some((o) => o.parser === p))) {
    const tally = tallies.get(parser);
    if (tally === undefined) continue;
    tally.fixtures += 1;
    tally.exact += exact ? 1 : 0;
    tally.fieldsTotal += expected.length * FIELDS.length;
    tally.fieldsRight += expected.reduce((sum, o) => sum + fieldsRight(o, run.plan.observations), 0);
  }
}

interface Overall {
  negatives: number;
  negativesUnparsed: number;
  listViews: number;
  listViewsNeutral: number;
  coveragePages: number;
  coveragePagesExact: number;
  coverageWindows: number;
  healthLabelled: number;
  healthMatched: number;
}

function healthMatches(f: LabelledFixture, run: ReceiptRun): boolean | null {
  const label = receiptHealthLabel(f);
  if (label === undefined) return null;
  const reasons = run.health.status === 'DEGRADED' ? run.health.reasons : [];
  return run.health.status === label.status && JSON.stringify(reasons) === JSON.stringify(label.reasons);
}

function scoreOverall(f: LabelledFixture, run: ReceiptRun, overall: Overall, negative: boolean): void {
  if (negative) {
    overall.negatives += 1;
    overall.negativesUnparsed += run.plan.observations.length === 0 ? 1 : 0;
  }
  if (f.page.view.startsWith('gmail.list.')) {
    overall.listViews += 1;
    overall.listViewsNeutral += run.health.status === 'OK' && run.plan.observations.length === 0 ? 1 : 0;
  }
  const asserted = planCoverage(run.plan);
  overall.coveragePages += 1;
  overall.coveragePagesExact +=
    JSON.stringify(asserted) === JSON.stringify(expectedReceiptCoverage(f)) ? 1 : 0;
  overall.coverageWindows += asserted.length;
  const health = healthMatches(f, run);
  if (health !== null) {
    overall.healthLabelled += 1;
    overall.healthMatched += health ? 1 : 0;
  }
}

function parserMetrics(tallies: Map<Parser, ParserTally>): Record<string, MetricValue> {
  const metrics: Record<string, MetricValue> = {};
  for (const [parser, tally] of tallies) {
    metrics[`${parser}Fixtures`] = tally.fixtures;
    metrics[`${parser}Exact`] = tally.exact;
    metrics[`${parser}FieldAccuracy`] =
      tally.fieldsTotal === 0 ? 0 : round4(tally.fieldsRight / tally.fieldsTotal);
  }
  return metrics;
}

function gatePassed(tallies: Map<Parser, ParserTally>, overall: Overall): boolean {
  const parsers = [...tallies.values()];
  return (
    parsers.every((t) => t.fixtures > 0 && t.exact === t.fixtures && t.fieldsRight === t.fieldsTotal) &&
    (tallies.get('generic')?.fixtures ?? 0) >= MIN_GENERIC_POSITIVES &&
    overall.negatives >= MIN_NEGATIVES &&
    overall.negativesUnparsed === overall.negatives &&
    overall.listViewsNeutral === overall.listViews &&
    overall.coveragePagesExact === overall.coveragePages &&
    overall.healthMatched === overall.healthLabelled
  );
}

/**
 * The receipt bench: per-parser and overall metrics, flat, with the `receiptParsersGatePassed` gate. `fixtures` is
 * replaced only by the bench's own tests (a corpus with real captures in it).
 */
export function runReceiptsBench(
  fixtures: readonly LabelledFixture[] = gmailFixtures(),
): Promise<Readonly<Record<string, MetricValue>>> {
  const tallies = new Map<Parser, ParserTally>(
    RECEIPT_PARSERS.map((p) => [p, { fixtures: 0, exact: 0, fieldsRight: 0, fieldsTotal: 0 }]),
  );
  const overall: Overall = {
    negatives: 0,
    negativesUnparsed: 0,
    listViews: 0,
    listViewsNeutral: 0,
    coveragePages: 0,
    coveragePagesExact: 0,
    coverageWindows: 0,
    healthLabelled: 0,
    healthMatched: 0,
  };
  const negatives = new Set(receiptNegatives(fixtures));
  for (const f of fixtures) {
    const run = runReceipts(f);
    if (receiptFacts(f).length > 0) scorePositive(f, run, tallies);
    scoreOverall(f, run, overall, negatives.has(f));
  }
  const fieldsRightAll = [...tallies.values()].reduce((sum, t) => sum + t.fieldsRight, 0);
  const fieldsTotalAll = [...tallies.values()].reduce((sum, t) => sum + t.fieldsTotal, 0);
  return Promise.resolve({
    gmailFixtures: fixtures.length,
    receiptRealFixtures: receiptScoredFixtures(fixtures).filter((f) => !f.page.synthetic).length,
    ...parserMetrics(tallies),
    receiptFieldAccuracy: fieldsTotalAll === 0 ? 0 : round4(fieldsRightAll / fieldsTotalAll),
    ...overall,
    receiptParsersGatePassed: gatePassed(tallies, overall),
  });
}
