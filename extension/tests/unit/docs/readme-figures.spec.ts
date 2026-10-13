/**
 * README.md's figures, each held to the RESULTS.md metric it reports (sprint_7 7.1; QA review, sprint 7). The
 * public-number check (./public-numbers.ts) asks only that a number is one RESULTS.md holds somewhere, and RESULTS.md
 * holds every whole number from 0 to 8 and from 10 to 15, so an attack's count changed from 6 to 5, or 18 of 25 to 17
 * of 25, still passes it. Here each row of "Attacks that still work" is its strategy's cases won, cases and severity in
 * the red team's result, and the table lists exactly the strategies whose outcome is "works"; the red team's counts in
 * the README's opening and in the Show HN post are the red team's own; and each Results row's figures are its bench's
 * named metrics, the table holding no row this file does not check.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { latestResults, type MetricValue } from '../../../../bench/results';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const README = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const SHOW_HN = readFileSync(path.join(REPO_ROOT, 'launch', 'show-hn.md'), 'utf8');
const METRICS = new Map(
  latestResults(path.join(REPO_ROOT, 'bench', 'results')).map((result) => [result.bench, result.metrics]),
);

/** `bench`'s metric `name`, which RESULTS.md must hold. */
function metric(bench: string, name: string): MetricValue {
  const value = METRICS.get(bench)?.[name];
  if (value === undefined) throw new Error(`RESULTS.md has no ${bench} ${name}`);
  return value;
}

/** `bench`'s numeric metric `name`. */
function num(bench: string, name: string): number {
  const value = metric(bench, name);
  if (typeof value !== 'number') throw new Error(`${bench} ${name} is not a number`);
  return value;
}

/** The text of the README's section `heading`, up to the next `## `. */
function section(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`README.md has no section "${heading}"`);
  const next = README.indexOf('\n## ', start + 1);
  return README.slice(start, next === -1 ? undefined : next);
}

/** The body rows of the one table in `text`, cell by cell. */
function rows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('|---'))
    .slice(1)
    .map((line) => line.slice(2, -2).split(' | '));
}

/** The numbers `pattern` captures in `text`, a percentage as its fraction; throws when it does not match. */
function figures(text: string, pattern: RegExp): number[] {
  const match = pattern.exec(text);
  if (match === null) throw new Error(`"${text}" does not read as ${String(pattern)}`);
  return match
    .slice(1)
    .map((written) => (written.endsWith('%') ? Number(written.slice(0, -1)) / 100 : Number(written)));
}

/** `written` and `measured` are the same numbers, in order. */
function expectSame(written: number[], measured: number[], what: string): void {
  expect(written.length, what).toBe(measured.length);
  for (const [index, value] of written.entries()) {
    expect(
      Math.abs(value - (measured[index] ?? Number.NaN)),
      `${what}: figure ${String(index + 1)}`,
    ).toBeLessThan(1e-9);
  }
}

interface Strategy {
  readonly number: string;
  readonly name: string;
  readonly cases: number;
  readonly works: number;
  readonly severity: string;
  readonly outcome: string;
}

/** Every red-team strategy RESULTS.md holds, from its `redteam<NN><Name>Cases` metric and its siblings. */
const STRATEGIES: readonly Strategy[] = Object.keys(METRICS.get('redteam') ?? {}).flatMap((key) => {
  const match = /^redteam(\d{2})([A-Za-z]+)Cases$/u.exec(key);
  if (match === null) return [];
  const [, number = '', name = ''] = match;
  const of = (field: string): MetricValue => metric('redteam', `redteam${number}${name}${field}`);
  return [
    {
      number,
      name,
      cases: num('redteam', key),
      works: num('redteam', `redteam${number}${name}Works`),
      severity: String(of('Severity')),
      outcome: String(of('Outcome')),
    },
  ];
});
const RANK = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** The strategy a README row names, by the words before its colon (`UNASKED evasion: …` is UnaskedEvasion). */
function strategyOf(label: string): Strategy {
  const key = (label.split(':')[0] ?? '').replace(/[^a-z]/giu, '').toLowerCase();
  const found = STRATEGIES.filter(({ name }) => name.toLowerCase().startsWith(key));
  const [only] = found;
  if (only === undefined || found.length !== 1)
    throw new Error(`"${label}" names ${String(found.length)} strategies`);
  return only;
}

/** The README's Results rows: each row's figures, then its limit's, as the metrics that measure them. */
const RESULT_ROWS: Readonly<
  Record<
    string,
    {
      readonly result: RegExp;
      readonly measured: () => number[];
      readonly limit?: RegExp;
      readonly limits?: () => number[];
    }
  >
> = {
  'Gmail Sent reader (`gmail-sent`)': {
    result: /^(\d+) of (\d+) labelled sends read, (\d+) of (\d+) fields right$/u,
    measured: () => [
      num('gmail-sent', 'gmailSentProducedObservations'),
      num('gmail-sent', 'gmailSentLabelledObservations'),
      num('gmail-sent', 'gmailSentFieldsCorrect'),
      num('gmail-sent', 'gmailSentFieldsCompared'),
    ],
    limit: /^(\d+%)$/u,
    limits: () => [num('gmail-sent', 'gmailSentAccuracyGate')],
  },
  'Calendar reader (`gcal`)': {
    result: /^(\d+) of (\d+) labelled events found, (\d+) spurious, (\d+) of (\d+) fields right$/u,
    measured: () => [
      num('gcal', 'gcalEventsFound'),
      num('gcal', 'gcalEventsLabelled'),
      num('gcal', 'gcalEventsSpurious'),
      num('gcal', 'gcalEventFieldsCorrect'),
      num('gcal', 'gcalEventFieldsChecked'),
    ],
    limit: /^(\d+%)$/u,
    limits: () => [num('gcal', 'gcalAccuracyThreshold')],
  },
  // The receipts bench's gate is every fixture exact (bench/observers/receipts.ts `gatePassed`) and RESULTS.md holds
  // no threshold of its own for it, so this row's limit cell has no metric to be held to (QA review, sprint 7).
  'Receipt emails (`receipts`)': {
    result:
      /^field accuracy (\d+(?:\.\d+)?) on every kind of receipt saved; (\d+) of (\d+) emails that are not receipts left unread$/u,
    measured: () => [
      num('receipts', 'receiptFieldAccuracy'),
      num('receipts', 'negativesUnparsed'),
      num('receipts', 'negatives'),
    ],
  },
  'Pasted activity logs (`paste`)': {
    result: /^(\d+) of (\d+) fields right over (\d+) invented logs$/u,
    measured: () => [
      num('paste', 'pasteFields') * num('paste', 'pasteFieldAccuracy'),
      num('paste', 'pasteFields'),
      num('paste', 'pasteLogs'),
    ],
    limit: /^(\d+%)$/u,
    limits: () => [num('paste', 'pasteAccuracyThreshold')],
  },
  'Action phrases (`patterns`)': {
    result:
      /^(\d\.\d+) of (\d+) Muse sentences given the right kind of action, (\d\.\d+) for each other agent, (\d+) wrong actions$/u,
    measured: () => {
      const others = ['chatgpt', 'dots', 'claude'].map((agent) => num('patterns', `${agent}TypeAccuracy`));
      expect(new Set(others).size, 'the other agents share one accuracy').toBe(1);
      const wrong = ['muse', 'chatgpt', 'dots', 'claude'].map((agent) =>
        num('patterns', `${agent}WrongActions`),
      );
      return [
        num('patterns', 'museTypeAccuracy'),
        num('patterns', 'museSentences'),
        others[0] ?? Number.NaN,
        wrong.reduce((sum, count) => sum + count, 0),
      ];
    },
    limit: /^(\d+%)$/u,
    limits: () => [num('patterns', 'patternsAccuracyThreshold')],
  },
  'Grading (`core`)': {
    result: /^(\d+) claims against (\d+) observations in (\d+(?:\.\d+)?) ms of CPU$/u,
    measured: () => [num('core', 'claims'), num('core', 'observations'), num('core', 'gradingCpuMedianMs')],
    limit: /^(\d+) ms$/u,
    limits: () => [num('core', 'gradingGateMs')],
  },
  'Popup (`popup`)': {
    result: /^first paint (\d+) ms over (\d+) receipts$/u,
    measured: () => [num('popup', 'popupFirstPaintMedianMs'), num('popup', 'popupReceipts')],
    limit: /^(\d+) ms$/u,
    limits: () => [num('popup', 'popupPaintGateMs')],
  },
  'A month of use (`perf`)': {
    result: /^(\d+) bytes in Chrome, popup first paint (\d+) ms$/u,
    measured: () => [num('perf', 'perfMonthStorageBytes'), num('perf', 'perfMonthPopupFirstPaintMedianMs')],
    limit: /^(\d+) bytes, (\d+) ms$/u,
    limits: () => [num('perf', 'perfMonthStorageGateBytes'), num('perf', 'perfMonthPopupGateMs')],
  },
  'Gmail Sent pass (`perf`)': {
    result: /^(\d+(?:\.\d+)?) ms over (\d+) rows$/u,
    measured: () => [num('perf', 'perfGmailPassMedianMs'), num('perf', 'perfGmailRows')],
    limit: /^(\d+) ms$/u,
    limits: () => [num('perf', 'perfGmailPassGateMs')],
  },
  'Red team (`redteam`)': {
    result: /^(\d+) cases in (\d+) strategies; (\d+) strategies still win$/u,
    measured: () => [
      num('redteam', 'redteamCases'),
      num('redteam', 'redteamStrategies'),
      num('redteam', 'redteamWorking'),
    ],
  },
};

describe("README.md's figures, each the metric it reports", () => {
  it('reads every red-team strategy RESULTS.md holds', () => {
    expect(STRATEGIES).toHaveLength(num('redteam', 'redteamStrategies'));
    expect(STRATEGIES.filter(({ outcome }) => outcome === 'works')).toHaveLength(
      num('redteam', 'redteamWorking'),
    );
  });

  it('lists in Attacks that still work exactly the strategies that work, each with its cases won, cases and severity', () => {
    const table = rows(section('Attacks that still work'));
    expect(table.length).toBeGreaterThan(0);
    const listed = table.map(([label = '', won = '', severity = '']) => {
      const strategy = strategyOf(label);
      expect(won, label).toBe(`${String(strategy.works)} of ${String(strategy.cases)}`);
      expect(severity, label).toBe(strategy.severity);
      return strategy.number;
    });
    const working = STRATEGIES.filter(({ outcome }) => outcome === 'works').map(({ number }) => number);
    expect([...listed].sort()).toEqual([...working].sort());
  });

  it.each([
    ['README.md opening', README.slice(0, README.indexOf('\n## '))],
    ['launch/show-hn.md', SHOW_HN],
  ])("%s: the red team's strategies that win, and the worst one's cases, are the red team's", (_, text) => {
    expectSame(
      figures(text, /\b(\d+) of (?:the )?(\d+) (?:attack )?strategies\b/u),
      [num('redteam', 'redteamWorking'), num('redteam', 'redteamStrategies')],
      'strategies',
    );
    const worst = [...STRATEGIES]
      .filter(({ outcome }) => outcome === 'works')
      .sort((a, b) => RANK.indexOf(a.severity) - RANK.indexOf(b.severity))[0];
    expect(worst).toBeDefined();
    expectSame(
      figures(text, /\bunflagged in (\d+) of (\d+) cases\b/u),
      [worst?.works ?? 0, worst?.cases ?? 0],
      'worst',
    );
  });

  it('writes in each Results row the figures and limit of the metrics it names, and has no other row', () => {
    const table = rows(section('Results'));
    expect(table.map(([what = '']) => what).sort()).toEqual(Object.keys(RESULT_ROWS).sort());
    for (const [what = '', result = '', limit = ''] of table) {
      const row = RESULT_ROWS[what];
      if (row === undefined) throw new Error(`no check for the Results row "${what}"`);
      expectSame(figures(result, row.result), row.measured(), what);
      if (row.limit !== undefined && row.limits !== undefined)
        expectSame(figures(limit, row.limit), row.limits(), `${what} limit`);
    }
  });

  it("names the Chrome the bench measured, and that the model's numbers are not measured", () => {
    const results = section('Results');
    expect(figures(results, /\(Chrome (\d+)\)/u)).toEqual([Number(metric('popup', 'popupChromeMajor'))]);
    expect(results).toContain('(`intelBuiltinMeasured` is false)');
    expect(metric('intel', 'intelBuiltinMeasured')).toBe(false);
  });
});
