/**
 * bench/observers/gmail.ts measures, it does not claim (agents/adapter_engineer.md rule 10; Hard Rule 12): each of
 * its whole-corpus gates turns false when an observer breaks the property it names. The accuracy gate's own
 * sensitivity is in ./sent-corpus.spec.ts. Each case wraps the real observer and changes one behaviour.
 */
import { describe, expect, it } from 'vitest';

import { runGmailBench } from '../../../../../bench/observers/gmail';
import { gmailSentObserver } from '../../../../src/observers/gmail/sent-observer';
import { sentWindow } from '../../../../src/observers/gmail/extract';
import type { ExtractContext, Observer, RawRow } from '../../../../src/observers/types';
import { loadSeeds } from '../../../e2e/support/leaks';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { gmailFixtures } from './sent-fixtures';

const wrap = (change: Partial<Observer>): Observer => ({ ...gmailSentObserver, ...change });

/** The real observer's rows with `map` applied to each. */
const mapRows = (map: (row: RawRow, doc: Document) => RawRow): Observer =>
  wrap({ extract: (doc, ctx) => gmailSentObserver.extract(doc, ctx).map((row) => map(row, doc)) });

describe('every bench gate can fail', () => {
  it('health: an observer that says OK on every page fails the health gate', async () => {
    const metrics = await runGmailBench(wrap({ health: () => ({ status: 'OK' }) }));
    expect(metrics.gmailSentHealthGatePassed).toBe(false);
  });

  it('negatives: an observer that reads a row on a page that is not the Sent list fails it', async () => {
    const row: RawRow = {
      type: 'email.sent',
      rowKey: 'invented',
      fields: { counterparty: 'nobody@example.net', occurredAt: '2026-10-01T09:00:00-04:00' },
    };
    const metrics = await runGmailBench(wrap({ health: () => ({ status: 'OK' }), extract: () => [row] }));
    expect(metrics.gmailSentNegativesGatePassed).toBe(false);
  });

  it('coverage: a window for the wrong account fails the coverage gate', async () => {
    const metrics = await runGmailBench(wrap({ account: () => 'someone.else@example.org' }));
    expect(metrics.gmailSentCoverageGatePassed).toBe(false);
  });

  it('coverage: asserting a window past the head of the list (page 2) fails the coverage gate', async () => {
    const everyPage = (doc: Document, ctx: ExtractContext) => {
      const span = sentWindow(doc, ctx);
      return span === null ? null : [span];
    };
    const metrics = await runGmailBench(wrap({ visibleWindows: everyPage }));
    expect(metrics.gmailSentCoverageGatePassed).toBe(false);
  });

  it('dedup: a row key that changes with the page fails the dedup gate', async () => {
    const metrics = await runGmailBench(
      mapRows((row, doc) => ({ ...row, rowKey: `${row.rowKey ?? ''}${doc.URL}` })),
    );
    expect(metrics.gmailSentDedupGatePassed).toBe(false);
  });

  it('seeds: a seeded secret in a subject hint fails the seeds gate', async () => {
    const [seed] = loadSeeds();
    if (seed === undefined) throw new Error('no seeds');
    const metrics = await runGmailBench(
      mapRows((row) => ({ ...row, fields: { ...row.fields, subjectHint: seed.value } })),
    );
    expect(metrics.gmailSentSeedsGatePassed).toBe(false);
  });
});

describe('the real-capture count describes the pages the accuracy is scored on (QA-V3; Hard Rule 12)', () => {
  /** The labelled corpus with `file` marked as a real capture. */
  const realOne = (file: string): LabelledFixture[] =>
    gmailFixtures().map((f) => (f.file === file ? { ...f, page: { ...f.page, synthetic: false } } : f));

  it('is 0 on the synthetic corpus', async () => {
    expect((await runGmailBench()).gmailSentRealFixtures).toBe(0);
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
});
