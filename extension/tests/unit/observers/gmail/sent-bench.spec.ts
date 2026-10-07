/**
 * bench/observers/gmail.ts measures, it does not claim (agents/adapter_engineer.md rule 10; Hard Rule 12): each of
 * its whole-corpus gates turns false when an observer breaks the property it names. The accuracy gate's own
 * sensitivity is in ./sent-corpus.spec.ts. Each case wraps the real observer and changes one behaviour.
 */
import { describe, expect, it } from 'vitest';

import { runGmailBench } from '../../../../../bench/observers/gmail';
import { gmailAccount } from '../../../../src/observers/gmail/account';
import { gmailSentObserver } from '../../../../src/observers/gmail/sent-observer';
import { sentWindow } from '../../../../src/observers/gmail/extract';
import type { ExtractContext, Observer, RawRow } from '../../../../src/observers/types';
import { loadSeeds } from '../../../e2e/support/leaks';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { gmailFixtures } from './sent-fixtures';

const wrap = (change: Partial<Observer>): Observer => ({ ...gmailSentObserver, ...change });

/** The hand-built pages only. */
const SYNTHETIC: LabelledFixture[] = gmailFixtures().filter((f) => f.page.synthetic);

/** The real observer's rows with `map` applied to each. */
const mapRows = (map: (row: RawRow, doc: Document) => RawRow): Observer =>
  wrap({ extract: (doc, ctx) => gmailSentObserver.extract(doc, ctx).map((row) => map(row, doc)) });

describe('every bench gate can fail', () => {
  // Each gate's sensitivity is shown on the synthetic pages, where every gate was shown to fail before the real
  // captures; the full corpus runs once (sent-corpus.spec.ts, the real-capture count below: TECH-R6).

  it('health: an observer that says OK on every page fails the health gate', async () => {
    const metrics = await runGmailBench(wrap({ health: () => ({ status: 'OK' }) }), SYNTHETIC);
    expect(metrics.gmailSentHealthGatePassed).toBe(false);
  });

  it('negatives: an observer that reads a row on a page that is not the Sent list fails it', async () => {
    const row: RawRow = {
      type: 'email.sent',
      rowKey: 'invented',
      fields: { counterparty: 'nobody@example.net', occurredAt: '2026-10-01T09:00:00-04:00' },
    };
    const metrics = await runGmailBench(
      wrap({ health: () => ({ status: 'OK' }), extract: () => [row] }),
      SYNTHETIC,
    );
    expect(metrics.gmailSentNegativesGatePassed).toBe(false);
  });

  it('coverage: a window for the wrong account fails the coverage gate', async () => {
    const metrics = await runGmailBench(wrap({ account: () => 'someone.else@example.org' }), SYNTHETIC);
    expect(metrics.gmailSentCoverageGatePassed).toBe(false);
  });

  it('coverage: asserting a window past the head of the list (page 2) fails the coverage gate', async () => {
    const everyPage = (doc: Document, ctx: ExtractContext) => {
      const span = sentWindow(doc, ctx);
      return span === null ? null : [span];
    };
    const metrics = await runGmailBench(wrap({ visibleWindows: everyPage }), SYNTHETIC);
    expect(metrics.gmailSentCoverageGatePassed).toBe(false);
  });
});

describe('every bench gate can fail: dedup and seeds', () => {
  it('dedup: a row key that changes with the page fails the dedup gate', async () => {
    const metrics = await runGmailBench(
      mapRows((row, doc) => ({ ...row, rowKey: `${row.rowKey ?? ''}${doc.URL}` })),
      SYNTHETIC,
    );
    expect(metrics.gmailSentDedupGatePassed).toBe(false);
  });

  it("seeds: the page's own account address as a recipient fails the seeds gate", async () => {
    const metrics = await runGmailBench(
      mapRows((row, doc) => ({ ...row, fields: { ...row.fields, counterparty: gmailAccount(doc) ?? '' } })),
      SYNTHETIC,
    );
    expect(metrics.gmailSentSeedsGatePassed).toBe(false);
  });

  it('seeds: a seeded secret in a subject hint fails the seeds gate', async () => {
    const [seed] = loadSeeds();
    if (seed === undefined) throw new Error('no seeds');
    const metrics = await runGmailBench(
      mapRows((row) => ({ ...row, fields: { ...row.fields, subjectHint: seed.value } })),
      SYNTHETIC,
    );
    expect(metrics.gmailSentSeedsGatePassed).toBe(false);
  });
});

describe('the real-capture count describes the pages the accuracy is scored on (QA-V3; Hard Rule 12)', () => {
  const synthetic = (): LabelledFixture[] => gmailFixtures().filter((f) => f.page.synthetic);
  /** The synthetic corpus with `file` marked as a real capture. */
  const realOne = (file: string): LabelledFixture[] =>
    synthetic().map((f) => (f.file === file ? { ...f, page: { ...f.page, synthetic: false } } : f));

  it('is 0 on the synthetic corpus', async () => {
    expect((await runGmailBench(gmailSentObserver, synthetic())).gmailSentRealFixtures).toBe(0);
  });

  it('a real Drafts or receipt capture is not a real Sent list: still 0', async () => {
    for (const file of ['synthetic-drafts.html', 'synthetic-receipt-amazon.html']) {
      expect((await runGmailBench(gmailSentObserver, realOne(file))).gmailSentRealFixtures, file).toBe(0);
    }
  });

  it('a real Sent list counts', async () => {
    const metrics = await runGmailBench(gmailSentObserver, realOne('synthetic-sent-page-1.html'));
    expect(metrics.gmailSentRealFixtures).toBe(1);
  });

  it('counts the real Sent lists of the corpus (capture of 2026-10-06: two pages, the last, the second account)', async () => {
    const real = gmailFixtures().filter((f) => !f.page.synthetic && f.page.view === 'gmail.list.sent');
    expect(real.map((f) => f.file).sort()).toEqual([
      'second-account-sent.html',
      'sent-list-1.html',
      'sent-list-2.html',
      'sent-list-last.html',
    ]);
    expect((await runGmailBench()).gmailSentRealFixtures).toBe(real.length);
  });
});
