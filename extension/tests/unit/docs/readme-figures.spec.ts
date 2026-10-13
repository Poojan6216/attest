/**
 * README.md's figures, each held to the RESULTS.md metric it reports (sprint_7 7.1; QA review, sprint 7). The
 * public-number check (./public-numbers.ts) asks only that a number is one RESULTS.md holds somewhere, and RESULTS.md
 * holds every whole number from 0 to 8 and from 10 to 15, so an attack's count changed from 6 to 5, or 18 of 25 to 17
 * of 25, still passes it. Here each row of "Attacks that still work" is its strategy's cases won, cases and severity in
 * the red team's result, and the table lists exactly the strategies whose outcome is "works"; and each Results row's
 * figures are its bench's named metrics, the table holding no row this file does not check. The receipts row's limit is
 * its bench's gate as the gate is (QA-3): every labelled receipt exact and no other email read. The red team's counts
 * in the README's opening and in the Show HN post are ./figures.ts's, with every other number posted (Sprint 7 close).
 */
import { describe, expect, it } from 'vitest';

import { read, section } from './copy-rules';
import { metric, num, STRATEGIES, type Strategy } from './figures';

const README = read('README.md');

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
      /** A limit that is a gate, not a number: as written, and whether the bench's gate holds. */
      readonly gate?: { readonly written: string; readonly holds: () => boolean };
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
  'Receipt emails (`receipts`)': {
    result:
      /^field accuracy (\d+(?:\.\d+)?) on every kind of receipt saved; (\d+) of (\d+) emails that are not receipts left unread$/u,
    measured: () => [
      num('receipts', 'receiptFieldAccuracy'),
      num('receipts', 'negativesUnparsed'),
      num('receipts', 'negatives'),
    ],
    // The receipts bench's gate is no threshold but every fixture exact, every email that is not a receipt unread and
    // every list view neutral (bench/observers/receipts.ts `gatePassed`): the limit says so, and holds while it passes.
    gate: {
      written: 'every labelled receipt exact, no other email read',
      holds: () =>
        metric('receipts', 'receiptParsersGatePassed') === true &&
        num('receipts', 'negativesUnparsed') === num('receipts', 'negatives') &&
        num('receipts', 'listViewsNeutral') === num('receipts', 'listViews'),
    },
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
    const table = rows(section(README, 'Attacks that still work'));
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

  it('writes in each Results row the figures and limit of the metrics it names, and has no other row', () => {
    const table = rows(section(README, 'Results'));
    expect(table.map(([what = '']) => what).sort()).toEqual(Object.keys(RESULT_ROWS).sort());
    for (const [what = '', result = '', limit = ''] of table) {
      const row = RESULT_ROWS[what];
      if (row === undefined) throw new Error(`no check for the Results row "${what}"`);
      expectSame(figures(result, row.result), row.measured(), what);
      if (row.limit !== undefined && row.limits !== undefined)
        expectSame(figures(limit, row.limit), row.limits(), `${what} limit`);
      if (row.gate !== undefined) {
        expect(limit, `${what} limit`).toBe(row.gate.written);
        expect(row.gate.holds(), `${what} gate`).toBe(true);
      }
    }
  });

  it("names the Chrome the bench measured, and that the model's numbers are not measured", () => {
    const results = section(README, 'Results');
    expect(figures(results, /\(Chrome (\d+)\)/u)).toEqual([Number(metric('popup', 'popupChromeMajor'))]);
    expect(results).toContain('(`intelBuiltinMeasured` is false)');
    expect(metric('intel', 'intelBuiltinMeasured')).toBe(false);
  });
});
