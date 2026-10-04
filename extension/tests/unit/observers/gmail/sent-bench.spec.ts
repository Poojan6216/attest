/**
 * bench/observers/gmail.ts measures, it does not claim (agents/adapter_engineer.md rule 10; Hard Rule 12): each of
 * its whole-corpus gates turns false when an observer breaks the property it names. The accuracy gate's own
 * sensitivity is in ./sent-corpus.spec.ts. Each case wraps the real observer and changes one behaviour.
 */
import { describe, expect, it } from 'vitest';

import { runGmailBench } from '../../../../../bench/observers/gmail';
import { gmailSentObserver } from '../../../../src/observers/gmail/sent-observer';
import type { Observer, RawRow } from '../../../../src/observers/types';
import { loadSeeds } from '../../../e2e/support/leaks';

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
