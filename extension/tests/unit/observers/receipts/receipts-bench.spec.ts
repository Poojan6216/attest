/**
 * bench/observers/receipts.ts says what its numbers were measured on (QA-4, QA-V3; Hard Rule 12; agents/
 * adapter_engineer.md rule 10): `receiptRealFixtures` counts the real captures among the pages the receipt numbers
 * are scored on (the positives and the negatives), never among every Gmail page. It is 0 on the hand-built synthetic
 * pages and 6 on the corpus: the receipt captures of 2026-10-07 (the founder's of 2026-10-06 were held out for
 * privacy, Decisions.md) hold 3 receipts and 3 negatives; their Shopify order, whose total reads "Rs.", is DEGRADED
 * and scored on its health only. RESULTS.md shows the count beside the accuracy.
 */
import { describe, expect, it } from 'vitest';

import { runReceiptsBench } from '../../../../../bench/observers/receipts';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { gmailFixtures, receiptNegatives, receiptPositives } from './receipt-fixtures';

/** The synthetic pages of the labelled corpus. */
const synthetic = (): LabelledFixture[] => gmailFixtures().filter((f) => f.page.synthetic);

/** The synthetic corpus with `file` marked as a real capture. */
const realOne = (file: string): LabelledFixture[] =>
  synthetic().map((f) => (f.file === file ? { ...f, page: { ...f.page, synthetic: false } } : f));

describe('the receipt bench counts real captures among the pages it scores', () => {
  it('reports the count, 0 on the synthetic corpus, and the gate still passes', async () => {
    const metrics = await runReceiptsBench(synthetic());
    expect(metrics.receiptRealFixtures).toBe(0);
    expect(metrics.receiptParsersGatePassed).toBe(true);
  });

  it('counts the 6 real captures it scores (3 receipts, 3 negatives of 2026-10-07); the gate passes', async () => {
    const metrics = await runReceiptsBench();
    expect(metrics.receiptRealFixtures).toBe(6);
    expect(metrics.receiptParsersGatePassed).toBe(true);
  });

  it('a real positive or a real negative counts', async () => {
    const [positive] = receiptPositives(synthetic());
    const [negative] = receiptNegatives(synthetic());
    for (const f of [positive, negative]) {
      if (f === undefined) throw new Error('the corpus lost its positives or negatives');
      expect((await runReceiptsBench(realOne(f.file))).receiptRealFixtures, f.file).toBe(1);
    }
  });

  it('a real Sent list or Inbox list is no receipt page: still 0', async () => {
    for (const file of ['synthetic-sent-page-1.html', 'synthetic-inbox.html']) {
      expect((await runReceiptsBench(realOne(file))).receiptRealFixtures, file).toBe(0);
    }
  });
});
