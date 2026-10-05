/**
 * Every observer bench says what its numbers were measured on (Hard Rule 12: never report an unmeasured number;
 * agents/adapter_engineer.md rule 10). Added by the Sprint 2 QA review. Until the founder's captures land (2.1, 2.4
 * BLOCKED(MANUAL)) every fixture is a hand-built synthetic page, so an accuracy of 1 in RESULTS.md describes those
 * pages only. bench/observers/gmail.ts reports `gmailSentRealFixtures` and bench/observers/gcal.ts
 * `gcalSyntheticFixtures`; each observer bench result must carry such a count, and it must be true of its corpus.
 */
import { describe, expect, it } from 'vitest';

import { runGcalBench } from '../../../../bench/observers/gcal';
import { runGmailBench } from '../../../../bench/observers/gmail';
import { runReceiptsBench } from '../../../../bench/observers/receipts';
import { type LabelledFixture, loadVendor } from '../fixtures/fixture-labels';

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
  it.each<[string, () => Promise<Readonly<Record<string, unknown>>>, 'gmail' | 'gcal']>([
    ['gmail-sent', () => runGmailBench(), 'gmail'],
    ['gcal', () => runGcalBench(), 'gcal'],
    ['receipts', () => runReceiptsBench(), 'gmail'],
  ])('%s', async (_name, run, vendor) => {
    const counts = corpusCounts(await run(), loadVendor(vendor));
    expect(counts.length, 'a real or synthetic fixture count among the metrics').toBeGreaterThan(0);
    for (const { name, reported, actual } of counts) expect(reported, name).toBe(actual);
  });
});
