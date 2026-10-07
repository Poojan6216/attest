/**
 * The Gmail Sent observer over the labelled fixture corpus (sprint_2 2.2 Done-when; tests/fixtures/pages/README.md).
 * Every Gmail fixture runs one full pass (health → extract → redact.project → account → window, as the skeleton
 * plans it) and must post exactly what its labels say:
 *  - on a Sent list, exactly the labelled observations (each label projected by `project()` at `readAt`, so ids,
 *    content hashes and row-key hashes are compared too), the labelled health and the labelled coverage;
 *  - on Drafts, the Inbox, an opened conversation and every opened receipt: DEGRADED, zero observations, no coverage;
 *  - the overlapping second page shares exactly the labelled rows with the first (dedup by contentHash);
 *  - no subjectHint over 80 code points, and no seeded secret or account address anywhere in a pass's output.
 * The field-accuracy number itself is bench/observers/gmail.ts's, checked here against its gate.
 */
import { describe, expect, it } from 'vitest';

import { runGmailBench } from '../../../../../bench/observers/gmail';
import { DEFAULT_POLICY } from '../../../../src/core/policy';
import { project } from '../../../../src/core/redact';
import type { Observation } from '../../../../src/core/schema';
import { accountHashOf } from '../../../../src/observers/account';
import { extractSent } from '../../../../src/observers/gmail/extract';
import { gmailSentObserver } from '../../../../src/observers/gmail/sent-observer';
import { planPass } from '../../../../src/observers/plan';
import type { Observer, RawRow } from '../../../../src/observers/types';
import { findLeaks, loadSeeds } from '../../../e2e/support/leaks';
import { type LabelledFixture, projectArgs } from '../../fixtures/fixture-labels';
import { fixtureCtx, gmailFixtures, openFixture, runSentPass, sentListFixtures } from './sent-fixtures';

const byHash = (a: Observation, b: Observation): number => a.contentHash.localeCompare(b.contentHash);

/** The labelled observations as `project()` returns them for this pass. */
function expectedObservations(fixture: LabelledFixture): Observation[] {
  return fixture.observations
    .filter((fact) => fact.source === 'gmail.sent')
    .map((fact) => {
      const { source, raw, ctx } = projectArgs(fact, fixture.page.readAt);
      return project(source, raw, ctx, DEFAULT_POLICY);
    })
    .sort(byHash);
}

describe('Sent lists: the pass posts exactly the labelled observations, health and coverage', () => {
  const lists = sentListFixtures();

  it('covers the ten labelled Sent-list fixtures, four of them real', () => {
    expect(lists.map((f) => f.file).sort()).toEqual([
      'second-account-sent.html',
      'sent-list-1.html',
      'sent-list-2.html',
      'sent-list-last.html',
      'synthetic-sent-account-2.html',
      'synthetic-sent-dst-auckland.html',
      'synthetic-sent-midnight.html',
      'synthetic-sent-page-1.html',
      'synthetic-sent-page-2.html',
      'synthetic-sent-time-unresolved.html',
    ]);
  });

  it.each(lists.map((f) => [f.file, f] as const))('%s', async (_file, fixture) => {
    const plan = await runSentPass(fixture);
    expect([...plan.observations].sort(byHash)).toEqual(expectedObservations(fixture));
    const health = fixture.health.find((h) => h.observer === 'gmail.sent');
    // The health a pass posts: a clean pass without coverage (a page past the head) reports OK.
    expect(plan.status === 'DEGRADED' ? 'DEGRADED' : 'OK').toBe(health?.status);
    expect(plan.status === 'DEGRADED' ? plan.reasons : []).toEqual(health?.reasons);
    const expected = fixture.coverage
      .filter((c) => c.source === 'gmail.sent')
      .map((coverage) => ({
        windowStart: coverage.windowStart,
        windowEnd: coverage.windowEnd === 'lastSyncAt' ? fixture.page.readAt : coverage.windowEnd,
        accountHash: accountHashOf(coverage.account),
      }));
    expect(plan.status === 'OK' ? plan.coverage : []).toEqual(expected);
  });
});

describe('every other Gmail page: DEGRADED, nothing extracted, no coverage', () => {
  const others = gmailFixtures().filter((f) => f.page.view !== 'gmail.list.sent');

  it.each(others.map((f) => [f.file, f] as const))('%s', async (_file, fixture) => {
    const plan = await runSentPass(fixture);
    const health = fixture.health.find((h) => h.observer === 'gmail.sent');
    expect(plan).toEqual({ status: 'DEGRADED', reasons: health?.reasons, observations: [] });
    const page = openFixture(fixture);
    try {
      expect(extractSent(page.doc, fixtureCtx(fixture))).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the Drafts fixture is refused as not_sent_folder', async () => {
    const drafts = others.find((f) => f.file === 'synthetic-drafts.html');
    if (drafts === undefined) throw new Error('no Drafts fixture');
    expect(await runSentPass(drafts)).toEqual({
      status: 'DEGRADED',
      reasons: ['not_sent_folder'],
      observations: [],
    });
  });
});

describe('dedup, subject length and seeds', () => {
  it('the second page shares exactly the labelled rows with the first (same contentHash)', async () => {
    for (const fixture of sentListFixtures().filter((f) => f.dedups.length > 0)) {
      const mine = new Set((await runSentPass(fixture)).observations.map((o) => o.contentHash));
      for (const fact of fixture.dedups) {
        const other = gmailFixtures().find((f) => f.file === fact.with);
        if (other === undefined) throw new Error(`no fixture ${fact.with}`);
        const shared = (await runSentPass(other)).observations.filter((o) => mine.has(o.contentHash));
        expect(shared, `${fixture.file} with ${fact.with}`).toHaveLength(fact.shared);
      }
    }
  });

  it('no subjectHint is over 80 code points, and the long subject is cut at exactly 80', async () => {
    const hints = (await Promise.all(sentListFixtures().map((f) => runSentPass(f)))).flatMap((plan) =>
      plan.observations.map((o) => Array.from(o.subjectHint ?? '').length),
    );
    expect(Math.max(...hints)).toBe(80);
  });

  // Each page is parsed once, for the raw rows and the pass (real pages are about 1 MB); the timeout is the measured
  // 8 s of the whole corpus with room for a loaded machine and coverage instrumentation (tech re-review, TECH-R6).
  it('no seeded secret or account address reaches the raw rows or the pass output', async () => {
    const seeds = loadSeeds();
    for (const fixture of gmailFixtures()) {
      const page = openFixture(fixture);
      try {
        const ctx = fixtureCtx(fixture);
        const raw = extractSent(page.doc, ctx);
        const plan = planPass({ observer: gmailSentObserver, doc: page.doc, ctx, policy: DEFAULT_POLICY });
        expect(findLeaks(fixture.file, { raw, plan }, seeds), fixture.file).toEqual([]);
        const text = JSON.stringify({ raw, plan }).toLowerCase();
        expect(text.includes(fixture.page.account.toLowerCase()), fixture.file).toBe(false);
      } finally {
        await page.close();
      }
    }
  }, 120_000);
});

describe('bench/observers/gmail.ts', () => {
  it('measures ≥ 95% field accuracy on the labelled Sent fixtures, and every gate passes', async () => {
    const metrics = await runGmailBench();
    expect(metrics.gmailSentAccuracyGatePassed).toBe(true);
    expect(metrics.gmailSentFieldsCompared).toBeGreaterThan(0);
    const gates = Object.entries(metrics).filter(([name]) => name.endsWith('GatePassed'));
    expect(gates.length).toBeGreaterThanOrEqual(7);
    expect(gates.filter(([, value]) => value !== true)).toEqual([]);
  }, 120_000);

  it('the number falls when an extractor gets a field wrong, drops rows or invents rows', async () => {
    // The gate's sensitivity, shown on the synthetic pages (the full corpus runs once, above: TECH-R6).
    const synthetic = gmailFixtures().filter((f) => f.page.synthetic);
    const rewrite = (map: (rows: RawRow[]) => RawRow[]): Observer => ({
      ...gmailSentObserver,
      extract: (doc, ctx) => map([...gmailSentObserver.extract(doc, ctx)]),
    });
    const wrongSubject = await runGmailBench(
      rewrite((rows) => rows.map((r) => ({ ...r, fields: { ...r.fields, subjectHint: 'Wrong' } }))),
      synthetic,
    );
    expect(wrongSubject.gmailSentSubjectHintAccuracy).toBe(0);
    expect(wrongSubject.gmailSentAccuracyGatePassed).toBe(false);
    const dropped = await runGmailBench(
      rewrite((rows) => rows.filter((_, at) => at % 2 === 0)),
      synthetic,
    );
    expect(dropped.gmailSentAccuracyGatePassed).toBe(false);
    const invented = await runGmailBench(
      rewrite((rows) => [...rows, ...rows.map((r) => ({ ...r, rowKey: `${r.rowKey ?? ''}x` }))]),
      synthetic,
    );
    expect(invented.gmailSentAccuracyGatePassed).toBe(false);
  });
});
