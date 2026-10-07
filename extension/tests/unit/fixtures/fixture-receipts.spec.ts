/**
 * The receipt corpus is wide enough to measure the parsers (sprint 2 task 2.3 Done-when; tests/fixtures/pages/README.md):
 * every parser the sprint lists has a labelled positive with merchant, amount and currency, the generic parser at
 * least three, and at least three opened Inbox messages are labelled as no receipt. Split from fixture-labels.spec.ts,
 * which checks every label against its page; no observer code runs here.
 */
import { describe, expect, it } from 'vitest';

import { labelFolders, loadLabels } from './fixture-labels';

const fixtures = labelFolders().flatMap(({ vendor, date }) => loadLabels(vendor, date));

describe('receipt corpus (2.3 Done-when)', () => {
  const gmail = fixtures.filter((f) => f.vendor === 'gmail');
  const receipts = gmail.flatMap((f) => f.observations.filter((o) => o.source === 'gmail.receipt'));

  it('names every parser the sprint lists, each with a labelled positive', () => {
    const parsers = new Set(receipts.map((o) => o.parser));
    for (const parser of [
      'stripe',
      'amazon',
      'marketplace',
      'opentable',
      'instacart',
      'uber',
      'shopify',
      'generic',
    ]) {
      expect(parsers, parser).toContain(parser);
    }
    for (const o of receipts)
      expect(o.merchant && o.amountCents !== undefined && o.currency, o.subjectHint).toBeTruthy();
  });

  it('has at least 3 generic positives and 3 opened-inbox negatives with no receipt', () => {
    expect(receipts.filter((o) => o.parser === 'generic').length).toBeGreaterThanOrEqual(3);
    const negatives = gmail.filter(
      (f) => f.page.view === 'gmail.message' && f.page.folder === 'inbox' && f.observations.length === 0,
    );
    expect(negatives.length).toBeGreaterThanOrEqual(3);
  });
});
