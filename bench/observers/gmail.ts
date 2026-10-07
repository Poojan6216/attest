/// <reference lib="dom" />
/**
 * Gmail Sent observer bench (sprint_2 2.2; agents/adapter_engineer.md rule 10; Hard Rule 12). Runs the observer's
 * full pass (health → extract → redact.project → account → window, src/observers/plan.ts) over every labelled Gmail
 * fixture and compares what it would post with the labels (extension/tests/fixtures/pages/gmail/<date>/labels.json).
 *
 * Field accuracy, over the fixtures that show the Sent list: each labelled observation is paired with a produced one
 * of the same row (`rowKeyHash` of the label's `rowKey`), by recipient first, then in order. Every pair scores its
 * three fields (recipient, subjectHint, occurredAt: exact strings, offset included; a missing subject equals a
 * missing subject). A labelled observation with no partner scores three misses, and so does a produced observation
 * nobody labelled, so dropping rows and inventing rows both lower the number. The gate is ≥ 95 %.
 *
 * Further gates, each a whole-corpus check: health status and reasons equal the label on every Gmail fixture; no
 * page other than the Sent list yields an observation; coverage is sent exactly where labelled (window and account
 * hash: only the head of the list asserts a window, sprint_2 2.7) and nowhere else; dedup facts hold (the
 * overlapping second page); no subjectHint is over 80 code points; no seeded secret (value or canary,
 * tests/e2e/support/leaks.ts matching) is in any pass output, nor a page's own account address in that page's. The
 * address of the user's other account can be a recipient there, as any address the user wrote to (a real Sent page
 * of 2026-10-06 holds a send from one account to the other): a page knows only the account it is signed in to.
 * `gmailSentRealFixtures` says how many of the pages are the founder's real captures (four Sent lists from
 * 2026-10-06; the rest are synthetic), counted over the Sent-list fixtures the accuracy is scored on (QA-V3), never
 * over every Gmail page.
 */
import { asciiLower } from '../../extension/src/core/normalize';
import { hashRowKey } from '../../extension/src/core/redact';
import type { Observation } from '../../extension/src/core/schema';
import { accountHashOf } from '../../extension/src/observers/account';
import { SENT_SELECTORS } from '../../extension/src/observers/gmail/selectors';
import { gmailSentObserver } from '../../extension/src/observers/gmail/sent-observer';
import type { PassPlan } from '../../extension/src/observers/plan';
import type { Observer } from '../../extension/src/observers/types';
import { findLeaks, loadSeeds } from '../../extension/tests/e2e/support/leaks';
import type { LabelledFixture, ObservationFact } from '../../extension/tests/unit/fixtures/fixture-labels';
import { gmailFixtures, runSentPass } from '../../extension/tests/unit/observers/gmail/sent-fixtures';
import type { MetricValue } from '../results';

/** The accuracy gate (sprint_2 2.2 Done-when). */
export const GMAIL_SENT_ACCURACY_GATE = 0.95;
const FIELDS = ['counterparty', 'subjectHint', 'occurredAt'] as const;
type Field = (typeof FIELDS)[number];

interface Tally {
  correct: Record<Field, number>;
  total: number;
  labelled: number;
  produced: number;
}

const newTally = (): Tally => ({
  correct: { counterparty: 0, subjectHint: 0, occurredAt: 0 },
  total: 0,
  labelled: 0,
  produced: 0,
});

/** Pairs a row's labelled and produced observations: same recipient first, the rest in order. */
function pairRow(
  labelled: readonly ObservationFact[],
  produced: readonly Observation[],
): { pairs: [ObservationFact, Observation][]; unpaired: number } {
  const free = [...produced];
  const pairs: [ObservationFact, Observation][] = [];
  const left: ObservationFact[] = [];
  for (const fact of labelled) {
    const at = free.findIndex((obs) => obs.counterparty === fact.counterparty);
    const [match] = at < 0 ? [] : free.splice(at, 1);
    if (match === undefined) left.push(fact);
    else pairs.push([fact, match]);
  }
  for (const fact of left) {
    const next = free.shift();
    if (next !== undefined) pairs.push([fact, next]);
  }
  return { pairs, unpaired: labelled.length + produced.length - 2 * pairs.length };
}

/** Adds one fixture's field scores to `tally`. */
function scoreFixture(fixture: LabelledFixture, plan: PassPlan, tally: Tally): void {
  const expected = fixture.observations.filter((fact) => fact.source === 'gmail.sent');
  const produced = plan.observations;
  tally.labelled += expected.length;
  tally.produced += produced.length;
  const keys = new Set([
    ...expected.map((fact) => hashRowKey(fact.rowKey ?? '')),
    ...produced.map((obs) => obs.rowKeyHash ?? ''),
  ]);
  for (const key of keys) {
    const { pairs, unpaired } = pairRow(
      expected.filter((fact) => hashRowKey(fact.rowKey ?? '') === key),
      produced.filter((obs) => obs.rowKeyHash === key),
    );
    tally.total += pairs.length + unpaired;
    for (const [fact, obs] of pairs) {
      for (const field of FIELDS) if (fact[field] === obs[field]) tally.correct[field] += 1;
    }
  }
}

const sameReasons = (a: readonly string[], b: readonly string[]): boolean =>
  [...a].sort().join('\n') === [...b].sort().join('\n');

/** The health a pass posts: OK for a clean pass, with or without coverage (src/observers/base.ts). */
const postedStatus = (plan: PassPlan): 'OK' | 'DEGRADED' => (plan.status === 'DEGRADED' ? 'DEGRADED' : 'OK');

function healthMatches(fixture: LabelledFixture, plan: PassPlan): boolean {
  const fact = fixture.health.find((h) => h.observer === 'gmail.sent');
  if (fact === undefined) return false;
  const reasons = plan.status === 'DEGRADED' ? plan.reasons : [];
  return fact.status === postedStatus(plan) && sameReasons(fact.reasons, reasons);
}

/** The pass asserts exactly the labelled gmail.sent windows (each with its account hash), in order, and no other. */
function coverageMatches(fixture: LabelledFixture, plan: PassPlan): boolean {
  const facts = fixture.coverage.filter((c) => c.source === 'gmail.sent');
  const asserted = plan.status === 'OK' ? plan.coverage : [];
  return (
    asserted.length === facts.length &&
    facts.every((fact, i) => {
      const windowEnd = fact.windowEnd === 'lastSyncAt' ? fixture.page.readAt : fact.windowEnd;
      const got = asserted[i];
      return (
        got?.windowStart === fact.windowStart &&
        got.windowEnd === windowEnd &&
        got.accountHash === accountHashOf(fact.account)
      );
    })
  );
}

function dedupHolds(fixture: LabelledFixture, plans: ReadonlyMap<string, PassPlan>): boolean {
  const mine = new Set(plans.get(fixture.file)?.observations.map((obs) => obs.contentHash));
  return fixture.dedups.every((fact) => {
    const theirs = plans.get(fact.with)?.observations ?? [];
    return theirs.filter((obs) => mine.has(obs.contentHash)).length === fact.shared;
  });
}

const ratio = (correct: number, total: number): number =>
  total === 0 ? 0 : Math.round((correct / total) * 10_000) / 10_000;

/** Whether the page's own account address, ASCII-lowercased, is anywhere in its pass output. */
const ownAccountIn = (fixture: LabelledFixture, plan: PassPlan): boolean =>
  JSON.stringify(plan).toLowerCase().includes(asciiLower(fixture.page.account));

/**
 * Runs the bench: one pass per labelled Gmail fixture. `observer` and `fixtures` are replaced only by the bench's own
 * tests (a broken observer; a corpus with real captures in it).
 */
export async function runGmailBench(
  observer: Observer = gmailSentObserver,
  fixtures: readonly LabelledFixture[] = gmailFixtures(),
): Promise<Readonly<Record<string, MetricValue>>> {
  const plans = new Map<string, PassPlan>();
  for (const fixture of fixtures) plans.set(fixture.file, await runSentPass(fixture, { observer }));
  const planOf = (fixture: LabelledFixture): PassPlan => {
    const plan = plans.get(fixture.file);
    if (plan === undefined) throw new Error(`no pass for ${fixture.file}`);
    return plan;
  };
  const sentLists = fixtures.filter((f) => f.page.view === 'gmail.list.sent');
  const tally = newTally();
  for (const fixture of sentLists) scoreFixture(fixture, planOf(fixture), tally);
  const correct = FIELDS.reduce((sum, field) => sum + tally.correct[field], 0);
  const accuracy = ratio(correct, tally.total * FIELDS.length);
  const hints = [...plans.values()].flatMap((plan) => plan.observations.map((obs) => obs.subjectHint ?? ''));
  const longestHint = Math.max(0, ...hints.map((hint) => Array.from(hint).length));
  return {
    gmailSentSelectorsVersion: SENT_SELECTORS.version,
    gmailFixtureFolders: [...new Set(fixtures.map((f) => f.date))].sort().join(','),
    gmailFixtures: fixtures.length,
    gmailSentListFixtures: sentLists.length,
    gmailSentRealFixtures: sentLists.filter((f) => !f.page.synthetic).length,
    gmailSentLabelledObservations: tally.labelled,
    gmailSentProducedObservations: tally.produced,
    gmailSentFieldsCompared: tally.total * FIELDS.length,
    gmailSentFieldsCorrect: correct,
    gmailSentRecipientAccuracy: ratio(tally.correct.counterparty, tally.total),
    gmailSentSubjectHintAccuracy: ratio(tally.correct.subjectHint, tally.total),
    gmailSentOccurredAtAccuracy: ratio(tally.correct.occurredAt, tally.total),
    gmailSentAccuracy: accuracy,
    gmailSentAccuracyGate: GMAIL_SENT_ACCURACY_GATE,
    gmailSentAccuracyGatePassed: tally.total > 0 && accuracy >= GMAIL_SENT_ACCURACY_GATE,
    gmailSentHealthGatePassed: fixtures.every((f) => healthMatches(f, planOf(f))),
    gmailSentNegativesGatePassed: fixtures
      .filter((f) => f.page.view !== 'gmail.list.sent')
      .every((f) => planOf(f).observations.length === 0 && planOf(f).status === 'DEGRADED'),
    gmailSentCoverageGatePassed: fixtures.every((f) => coverageMatches(f, planOf(f))),
    gmailSentDedupGatePassed: fixtures.every((f) => dedupHolds(f, plans)),
    gmailSentSubjectHintMaxCodePoints: longestHint,
    gmailSentSubjectHintGatePassed: longestHint <= 80,
    gmailSentSeedsGatePassed:
      findLeaks('gmail.sent', [...plans.values()], loadSeeds()).length === 0 &&
      fixtures.every((f) => !ownAccountIn(f, planOf(f))),
  };
}
