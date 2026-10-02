/**
 * docs/grading.md §16 (task 1.11): the worked examples restate golden files and must never disagree with them.
 * The golden runner (tests/golden/golden.spec.ts) proves the files against the code; this proves the doc against
 * the files, so a number in the doc always has a source (agents/docs_writer.md rule 1). Each check is also run
 * on a broken copy of the doc to prove it can fail.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadGoldenFiles,
  loadPolicyRules,
  mandatoryProblems,
  REPO_ROOT,
  ruleRows,
  ruleTableProblems,
  sectionProblems,
  summaryProblems,
  summaryRows,
} from './worked-examples-check';

const DOC = readFileSync(path.join(REPO_ROOT, 'docs', 'grading.md'), 'utf8');
const GOLDEN = loadGoldenFiles();
const POLICY = loadPolicyRules();

/** Every problem the four checks find in a version of the doc. */
function problemsIn(doc: string): string[] {
  const rows = summaryRows(doc);
  return [
    ...summaryProblems(rows, GOLDEN),
    ...mandatoryProblems(rows, GOLDEN),
    ...sectionProblems(doc, rows),
    ...ruleTableProblems(ruleRows(doc), rows, POLICY, GOLDEN),
  ];
}

/** The doc with exactly one occurrence of `from` replaced. */
function broken(from: string, to: string): string {
  expect(DOC.split(from)).toHaveLength(2);
  return DOC.replace(from, to);
}

describe('docs/grading.md §16 worked examples', () => {
  it('has a summary row for every receipt of the 12 mandatory scenarios and the §2 demo', () => {
    const rows = summaryRows(DOC);
    expect(rows.length).toBeGreaterThanOrEqual(17);
    expect(mandatoryProblems(rows, GOLDEN)).toEqual([]);
  });

  it('states the grade, rule, state and score that each cited golden file expects', () => {
    expect(summaryProblems(summaryRows(DOC), GOLDEN)).toEqual([]);
  });

  it('gives every example its own section, named by its anchor, linking its golden file', () => {
    expect(sectionProblems(DOC, summaryRows(DOC))).toEqual([]);
  });

  it('§16.15 lists every policy rule in order, plus default_unverifiable, each with files that end on it', () => {
    const rules = ruleRows(DOC);
    expect(rules).toHaveLength(POLICY.length + 1);
    expect(ruleTableProblems(rules, summaryRows(DOC), POLICY, GOLDEN)).toEqual([]);
  });

  it('points at the canonical worked example, extension/tests/unit/core/demo.spec.ts', () => {
    expect(DOC).toContain('**canonical worked example** is the §2 demo as a test');
    expect(DOC).toContain('](../extension/tests/unit/core/demo.spec.ts)');
  });
});

describe('the §16 checks reject a broken summary row', () => {
  it.each([
    [
      'a wrong score',
      '| c1 | VERIFIED | `verified` | FINAL | 787/792 |',
      '| c1 | VERIFIED | `verified` | FINAL | 1/1 |',
      '16.12 c1: score is 1/1 in the doc, 787/792 in 12-timezone-midnight-edge.json',
    ],
    [
      'a wrong state',
      '| c1 | UNVERIFIABLE | `partial_coverage` | PENDING | none |',
      '| c1 | UNVERIFIABLE | `partial_coverage` | FINAL | none |',
      '16.6 c1: state is FINAL in the doc, PENDING in 06-purchase-without-receipt-parser.json',
    ],
    [
      'a wrong rule',
      '| o1 | UNASKED | `unasked` | FINAL | none |',
      '| o1 | UNASKED | `over_scope` | FINAL | none |',
      '16.7 o1: rule is over_scope in the doc, unasked in 07-unasked-attribution-0-7.json',
    ],
    [
      'a receipt the file does not expect',
      '| c2 | UNVERIFIABLE | `no_coverage` | PENDING | none |',
      '| c9 | UNVERIFIABLE | `no_coverage` | PENDING | none |',
      '16.14 c9: 14-demo-calendar-coverage-absent.json expects no receipt c9',
    ],
  ])('%s', (_name, from, to, problem) => {
    expect(problemsIn(broken(from, to))).toContain(problem);
  });
});

describe('the §16 checks reject an example section that no longer states its rule, state or score', () => {
  it.each([
    [
      'a rule',
      'so the first match is `not_found`.',
      'so the first match is `over_scope`.',
      '16.4 c1: section does not state its rule `not_found`',
    ],
    [
      'a state',
      "- **State.** FINAL at once (§8): the claim's own amount decided it.",
      "- **State.** at once (§8): the claim's own amount decided it.",
      '16.9 c1: section does not state its state FINAL',
    ],
    [
      'a score',
      '396 000 = 787/792.',
      '396 000 = 786/792.',
      '16.12 c1: section does not state its score 787/792',
    ],
  ])('%s', (_name, from, to, problem) => {
    expect(problemsIn(broken(from, to))).toContain(problem);
  });
});

describe('the §16 checks reject a broken doc structure', () => {
  it('a mandatory scenario with no worked example', () => {
    const row = DOC.split('\n').find((line) => line.startsWith('| [16.9]'));
    expect(row).toBeDefined();
    expect(problemsIn(broken(`${row ?? ''}\n`, ''))).toContain(
      'no worked example covers ledger_engineer:amount_above_ceiling',
    );
  });

  it('an example whose heading no longer matches its anchor', () => {
    const doc = broken('### 16.3 No observation, grace not elapsed', '### 16.3 No observation yet');
    expect(problemsIn(doc)).toContain(
      '16.3: anchor #163-no-observation-grace-not-elapsed is not its heading',
    );
  });

  it('a §16.15 golden file that never ends on the rule, and a missing rule row', () => {
    const wrongFile = broken(
      '[26](../extension/tests/golden/26-calendar-without-target.json)',
      '[51](../extension/tests/golden/51-default-unverifiable.json)',
    );
    expect(problemsIn(wrongFile)).toContain(
      'no_target: ../extension/tests/golden/51-default-unverifiable.json never ends on it',
    );
    const row = DOC.split('\n').find((line) => line.startsWith('| `over_scope_observed` |'));
    expect(problemsIn(broken(`${row ?? ''}\n`, ''))[0]).toMatch(/^rule rows are \[unasked, over_scope, /);
  });

  it('a §16.15 example that does not end on the rule, and a wrong "then"', () => {
    const doc = broken('| `partial` | PARTIAL | [16.2]', '| `partial` | VERIFIED | [16.1]');
    expect(problemsIn(doc)).toEqual(
      expect.arrayContaining([
        'partial: then is VERIFIED, policy says PARTIAL',
        'partial: example 16.1 has no summary row with this rule',
      ]),
    );
  });
});
