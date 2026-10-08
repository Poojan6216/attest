/**
 * Every observer bench says what its numbers were measured on (Hard Rule 12: never report an unmeasured number;
 * agents/adapter_engineer.md rule 10). Added by the Sprint 2 QA review, when every fixture was a hand-built synthetic
 * page; the founder's first real captures (2026-10-06) joined them. bench/observers/gmail.ts reports
 * `gmailSentRealFixtures`, bench/observers/receipts.ts `receiptRealFixtures` and bench/observers/gcal.ts
 * `gcalSyntheticFixtures`; each observer bench result must carry such a count, true of the pages its numbers are
 * scored on (QA-V3): the Sent lists, the receipt positives and negatives, every Calendar page.
 */
import { describe, expect, it } from 'vitest';

import { runGcalBench } from '../../../../bench/observers/gcal';
import { runGmailBench } from '../../../../bench/observers/gmail';
import { runReceiptsBench } from '../../../../bench/observers/receipts';
import { type LabelledFixture, loadVendor } from '../fixtures/fixture-labels';
import { receiptScoredFixtures } from './receipts/receipt-fixtures';

/** Each metric of a bench result that counts real or synthetic fixtures, with the count its corpus gives. */
function corpusCounts(
  metrics: Readonly<Record<string, unknown>>,
  corpus: readonly LabelledFixture[],
): { readonly name: string; readonly reported: unknown; readonly actual: number }[] {
  return Object.entries(metrics).flatMap(([name, reported]) => {
    if (name.endsWith('RealFixtures')) {
      return [{ name, reported, actual: corpus.filter((f) => !f.page.synthetic).length }];
    }
    if (name.endsWith('SyntheticFixtures')) {
      return [{ name, reported, actual: corpus.filter((f) => f.page.synthetic).length }];
    }
    return [];
  });
}

describe('every observer bench says how many of its fixtures are real captures', () => {
  it.each<[string, () => Promise<Readonly<Record<string, unknown>>>, () => readonly LabelledFixture[]]>([
    [
      'gmail-sent',
      () => runGmailBench(),
      () => loadVendor('gmail').filter((f) => f.page.view === 'gmail.list.sent'),
    ],
    ['gcal', () => runGcalBench(), () => loadVendor('gcal')],
    ['receipts', () => runReceiptsBench(), () => receiptScoredFixtures(loadVendor('gmail'))],
  ])('%s', async (_name, run, scored) => {
    const counts = corpusCounts(await run(), scored());
    expect(counts.length, 'a real or synthetic fixture count among the metrics').toBeGreaterThan(0);
    for (const { name, reported, actual } of counts) expect(reported, name).toBe(actual);
  });

  it('the scored pages hold the real captures: 4 Sent lists, 6 receipt pages and 10 Calendar pages', () => {
    const real = (corpus: readonly LabelledFixture[]) => corpus.filter((f) => !f.page.synthetic).length;
    expect(real(loadVendor('gmail').filter((f) => f.page.view === 'gmail.list.sent'))).toBe(4);
    expect(real(receiptScoredFixtures(loadVendor('gmail')))).toBe(6);
    expect(real(loadVendor('gcal'))).toBe(10);
  });
});
