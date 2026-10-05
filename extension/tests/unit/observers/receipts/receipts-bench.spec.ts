/**
 * bench/observers/receipts.ts says what its numbers were measured on (QA-4, QA-V3; Hard Rule 12; agents/
 * adapter_engineer.md rule 10): `receiptRealFixtures` counts the real captures among the pages the receipt numbers
 * are scored on (the positives and the negatives), never among every Gmail page. Until the founder's captures land
 * every fixture is synthetic, so it is 0, and RESULTS.md shows that beside the accuracy.
 */
import { describe, expect, it } from 'vitest';

import { runReceiptsBench } from '../../../../../bench/observers/receipts';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import { gmailFixtures, receiptNegatives, receiptPositives } from './receipt-fixtures';

/** The labelled corpus with `file` marked as a real capture. */
const realOne = (file: string): LabelledFixture[] =>
  gmailFixtures().map((f) => (f.file === file ? { ...f, page: { ...f.page, synthetic: false } } : f));

describe('the receipt bench counts real captures among the pages it scores', () => {
  it('reports the count, 0 on the synthetic corpus, and the gate still passes', async () => {
    const metrics = await runReceiptsBench();
    expect(metrics.receiptRealFixtures).toBe(0);
    expect(metrics.receiptParsersGatePassed).toBe(true);
  });

  it('a real positive or a real negative counts', async () => {
    const [positive] = receiptPositives(gmailFixtures());
    const [negative] = receiptNegatives(gmailFixtures());
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
