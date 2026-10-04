/**
 * The Gmail receipt observer against its labelled fixtures (sprint_2 2.3 Done-when; tests/fixtures/pages/README.md).
 *
 *  - each parser passes its labelled fixture: the parser the label names claims the message, and the pass yields
 *    exactly the labelled observations after `redact.project()` (merchant, amount to the cent, currency, subject
 *    hint, occurredAt, type, row key), with the generic parser's declared confidence;
 *  - the generic parser has at least 3 positives and 3 negatives, and every negative stays unparsed;
 *  - every page reports the labelled gmail.receipt health; a list view is neutral (OK, nothing read);
 *  - no pass ever asserts coverage, and nothing a pass reports holds a seeded secret (Hard Rules 2, 5).
 * The same holds with the page at a blank address (DOM landmarks only) as at its live `#inbox/<id>` address.
 */
import { describe, expect, it } from 'vitest';

import seededJson from '../../../fixtures/secrets/seeded.json';
import type { LabelledFixture } from '../../fixtures/fixture-labels';
import {
  expectedReceipts,
  gmailFixtures,
  receiptHealthLabel,
  type ReceiptRun,
  runReceipts,
} from './receipt-fixtures';

const fixtures = gmailFixtures();
const runs = new Map<string, ReceiptRun>(fixtures.map((f) => [f.file, runReceipts(f)]));
const runOf = (f: LabelledFixture): ReceiptRun => {
  const run = runs.get(f.file);
  if (run === undefined) throw new Error(`no run for ${f.file}`);
  return run;
};

const receiptFacts = (f: LabelledFixture) => f.observations.filter((o) => o.source === 'gmail.receipt');
const positives = fixtures.filter((f) => receiptFacts(f).length > 0);
const negatives = fixtures.filter(
  (f) => f.page.view === 'gmail.message' && f.page.folder === 'inbox' && receiptFacts(f).length === 0,
);
const lists = fixtures.filter((f) => f.page.view.startsWith('gmail.list.'));

describe('each parser passes its labelled fixture', () => {
  it.each(positives.map((f) => [f.file, f] as const))('%s', (_file, f) => {
    const run = runOf(f);
    expect(run.plan.status).toBe('OK_NO_COVERAGE');
    expect(run.plan.observations).toEqual(expectedReceipts(f));
    const [fact] = receiptFacts(f);
    const claimed = run.verdicts.filter((v) => v.verdict.kind === 'receipt');
    expect(claimed.map((v) => [v.key, v.parser])).toEqual([[fact?.rowKey, fact?.parser]]);
    const [verdict] = claimed;
    if (verdict?.verdict.kind !== 'receipt') throw new Error('unreachable');
    expect(verdict.verdict.facts.confidence).toBe(fact?.confidence);
  });

  it('covers all eight parsers the sprint lists, the gate set of build_spec §8 included', () => {
    const parsers = new Set(positives.flatMap((f) => receiptFacts(f).map((o) => o.parser)));
    expect([...parsers].sort()).toEqual(
      ['amazon', 'generic', 'instacart', 'marketplace', 'opentable', 'shopify', 'stripe', 'uber'].sort(),
    );
  });

  it('reads every amount exactly, as an integer number of minor units in an ISO currency', () => {
    for (const f of positives) {
      for (const o of runOf(f).plan.observations) {
        expect(Number.isSafeInteger(o.amountCents), f.file).toBe(true);
        expect(o.currency, f.file).toMatch(/^[A-Z]{3}$/);
      }
    }
  });
});

describe('the generic parser: positives parse, negatives (newsletters with prices) never do', () => {
  it('has at least 3 labelled positives and 3 labelled negatives, each negative read by the generic parser', () => {
    const generic = positives.filter((f) => receiptFacts(f).some((o) => o.parser === 'generic'));
    expect(generic.length).toBeGreaterThanOrEqual(3);
    const readByGeneric = negatives.filter((f) => runOf(f).verdicts.every((v) => v.parser === 'generic'));
    expect(readByGeneric.length).toBeGreaterThanOrEqual(3);
  });

  it.each(negatives.map((f) => [f.file, f] as const))('%s stays unparsed', (_file, f) => {
    const run = runOf(f);
    expect(run.plan.observations).toEqual([]);
    expect(run.verdicts.map((v) => v.verdict.kind)).toEqual(['none']);
  });
});

describe('health and coverage honesty (Hard Rules 5, 6)', () => {
  it('every page reports its labelled gmail.receipt health', () => {
    for (const f of fixtures) {
      const label = receiptHealthLabel(f);
      if (label === undefined) continue;
      const health = runOf(f).health;
      expect(health.status, f.file).toBe(label.status);
      expect(health.status === 'DEGRADED' ? health.reasons : [], f.file).toEqual(label.reasons);
    }
  });

  it.each(lists.map((f) => [f.file, f] as const))('list view %s is neutral: OK, nothing read', (_file, f) => {
    const run = runOf(f);
    expect(run.health).toEqual({ status: 'OK' });
    expect(run.plan).toEqual({ status: 'OK_NO_COVERAGE', observations: [] });
    expect(run.verdicts).toEqual([]);
  });

  it('no fixture pass asserts coverage: every plan is OK_NO_COVERAGE, never OK with a window', () => {
    for (const f of fixtures) expect(runOf(f).plan.status, f.file).toBe('OK_NO_COVERAGE');
  });

  it('reads the same at a blank address as at the live address (DOM landmarks alone suffice)', () => {
    for (const f of fixtures) {
      const blank = runReceipts(f, false);
      expect(blank.plan, f.file).toEqual(runOf(f).plan);
      expect(blank.health, f.file).toEqual(runOf(f).health);
    }
  });
});

describe('redaction at the edge (Hard Rule 2)', () => {
  const seeds = seededJson.seeds.flatMap((seed) => [seed.value, ...seed.canaries]);

  it('no seeded secret and no body line reaches what a pass reports', () => {
    for (const f of fixtures) {
      const text = JSON.stringify(runOf(f).plan).toLowerCase();
      for (const seed of seeds) expect(text, `${f.file}: ${seed}`).not.toContain(seed.toLowerCase());
    }
  });

  it('every observation holds only the gmail.receipt allowlist and the derived fields', () => {
    const allowed = ['merchant', 'amountCents', 'currency', 'subjectHint', 'occurredAt'];
    const derived = ['id', 'source', 'type', 'observedAt', 'rowKeyHash', 'contentHash'];
    for (const f of positives) {
      for (const o of runOf(f).plan.observations) {
        for (const key of Object.keys(o))
          expect([...allowed, ...derived], `${f.file}: ${key}`).toContain(key);
      }
    }
  });
});
