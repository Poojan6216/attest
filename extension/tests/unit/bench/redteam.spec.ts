/**
 * The red-team harness (sprint_6 6.0; agents/red_team.md) on folders this test writes, with a stand-in for the browser
 * that returns the ledger a case left: an empty attacks folder gives an empty report, one strategy gives one row, a
 * receipt outside an expectation is the attack working at agents/red_team.md rule 4's severity, and a bad fixture
 * fails naming its file. The real pipeline runs in tests/e2e/redteam-harness.spec.ts. Every value is invented.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prefixOf, reportMetrics, runRedteamBench } from '../../../../bench/redteam';
import { BENCHES, selectedBenches } from '../../../../bench/run_bench';
import { Ulid } from '../../../src/core/schema';
import { loadAttacks } from '../../redteam/attack-schema';
import { type CaseRunner, runRedteam } from '../../redteam/harness';
import { type JudgedLedger, severityOf, violationsOf } from '../../redteam/outcome';

const FIRST = Ulid.parse('01J9Z5Q3K4M5N6P7Q8R9S0T1V2');
const SECOND = Ulid.parse('01J9Z5Q3K4M5N6P7Q8R9S0T1V3');
const claimId = (index: number) => (index === 0 ? FIRST : SECOND);
const OBSERVATION = Ulid.parse('01J9Z5Q3K4M5N6P7Q8R9S0T1V4');

/** The one case of the strategy below: three sends claimed to one person, one Sent row; at most one VERIFIED. */
const CASE = {
  id: 'three-claims-one-row',
  attack: 'Three sends claimed, one made',
  pages: [
    {
      kind: 'gmail.sent',
      rows: [
        { name: 'Priya', email: 'priya@company.example', subject: 'Deck', snippet: 'Here.', minutesAgo: 120 },
      ],
    },
  ],
  log: { agent: 'muse', lines: [{ text: 'Sent email "Deck" to Priya', minutesAgo: 120 }] },
  expect: [
    {
      claims: { counterparty: 'Priya' },
      allowed: ['VERIFIED', 'PARTIAL', 'NOT_FOUND', 'UNVERIFIABLE'],
      maxVerified: 1,
    },
  ],
};
const INFLATION = { number: 1, strategy: 'claim-inflation', title: 'Claim inflation', cases: [CASE] };

/** The ledger a case left: one claim to Priya per grade given, each with its receipt. */
function ledgerOf(...grades: ('VERIFIED' | 'NOT_FOUND')[]): JudgedLedger {
  return {
    tables: {
      claims: grades.map((_, index) => ({
        id: claimId(index),
        counterparty: 'Priya',
        type: 'email.sent' as const,
      })),
      receipts: grades.map((grade, index) => ({
        claimId: claimId(index),
        observationIds: [OBSERVATION],
        grade,
      })),
    },
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'attest-redteam-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeStrategy(name: string, file: unknown): void {
  mkdirSync(path.join(dir, name));
  writeFileSync(path.join(dir, name, 'expected.json'), JSON.stringify(file));
}

const never: CaseRunner = () => Promise.reject(new Error('no case should run'));
const leaving =
  (...grades: ('VERIFIED' | 'NOT_FOUND')[]): CaseRunner =>
  () =>
    Promise.resolve(ledgerOf(...grades));

describe('the red-team harness on an empty folder and on one fixture (sprint_6 6.0)', () => {
  it('runs on an empty attacks folder and gives an empty report, launching nothing', async () => {
    expect(await runRedteam(loadAttacks(dir), never)).toEqual({ rows: [], cases: [] });
    expect(await runRedteamBench(dir, never)).toEqual({
      redteamStrategies: 0,
      redteamCases: 0,
      redteamWorking: 0,
    });
  });

  it('gives one row for one fixture, from the ledger its case left', async () => {
    writeStrategy('claim-inflation', INFLATION);
    const report = await runRedteam(loadAttacks(dir), leaving('VERIFIED'));
    expect(report.rows).toEqual([
      {
        number: 1,
        strategy: 'claim-inflation',
        title: 'Claim inflation',
        cases: 1,
        works: 0,
        rate: 0,
        severity: 'none',
        outcome: 'caught',
        grades: 'VERIFIED 1',
      },
    ]);
    const lines: string[] = [];
    expect(await runRedteamBench(dir, leaving('VERIFIED'), (line) => lines.push(line))).toEqual({
      redteamStrategies: 1,
      redteamCases: 1,
      redteamWorking: 0,
      redteam01ClaimInflationCases: 1,
      redteam01ClaimInflationWorks: 0,
      redteam01ClaimInflationRate: 0,
      redteam01ClaimInflationSeverity: 'none',
      redteam01ClaimInflationOutcome: 'caught',
      redteam01ClaimInflationGrades: 'VERIFIED 1',
    });
    expect(lines).toEqual([]);
  });
});

describe('an attack that works', () => {
  it('is reported at its severity, with a line saying how', async () => {
    writeStrategy('claim-inflation', INFLATION);
    const lines: string[] = [];
    expect(
      await runRedteamBench(dir, leaving('VERIFIED', 'VERIFIED'), (line) => lines.push(line)),
    ).toMatchObject({
      redteamWorking: 1,
      redteam01ClaimInflationWorks: 1,
      redteam01ClaimInflationRate: 1,
      redteam01ClaimInflationSeverity: 'CRITICAL',
      redteam01ClaimInflationOutcome: 'works',
      redteam01ClaimInflationGrades: 'VERIFIED 2',
    });
    expect(lines).toEqual([
      'redteam claim-inflation/three-claims-one-row: CRITICAL: claims to Priya: 2 VERIFIED where at most 1 is right',
    ]);
  });

  it.each([
    [['NOT_FOUND', 'UNVERIFIABLE'], 'VERIFIED', 'CRITICAL'],
    [['UNASKED'], 'VERIFIED', 'HIGH'],
    [['OVER_SCOPE'], null, 'HIGH'],
    [['VERIFIED', 'PARTIAL'], 'NOT_FOUND', 'MEDIUM'],
    [['UNVERIFIABLE'], 'PARTIAL', 'LOW'],
    [['VERIFIED'], null, 'LOW'],
  ] as const)('allowed %j, given %s, is %s (agents/red_team.md rule 4)', (allowed, actual, severity) => {
    expect(severityOf(allowed, actual)).toBe(severity);
  });

  it('misses a flag when the action it flags has no receipt at all: HIGH', () => {
    expect(violationsOf(ledgerOf(), { orphans: true, count: 1, allowed: ['UNASKED'] })).toEqual([
      { severity: 'HIGH', problem: 'receipts no claim made: 0 receipts where 1 is right' },
    ]);
  });
});

const ON_GMAIL = 'https://mail.google.com/mail/u/0/#sent';
const withCase = (change: Record<string, unknown>) => ({ ...INFLATION, cases: [{ ...CASE, ...change }] });

/** Each bad fixture, how it is written, and what its failure names. */
const BAD_FIXTURES: readonly (readonly [string, () => void, RegExp])[] = [
  [
    'a folder without expected.json',
    () => {
      mkdirSync(path.join(dir, 'claim-inflation'));
    },
    /expected\.json: missing/u,
  ],
  [
    'a file that is not JSON',
    () => {
      mkdirSync(path.join(dir, 'claim-inflation'));
      writeFileSync(path.join(dir, 'claim-inflation', 'expected.json'), '{');
    },
    /expected\.json: not JSON/u,
  ],
  [
    'a strategy named apart from its folder',
    () => {
      writeStrategy('paraphrase-drift', INFLATION);
    },
    /"paraphrase-drift"/u,
  ],
  [
    'a page file not in the folder',
    () => {
      writeStrategy(
        'claim-inflation',
        withCase({ pages: [{ kind: 'file', file: 'spoof.html', url: ON_GMAIL }] }),
      );
    },
    /spoof\.html is not in the folder/u,
  ],
  [
    'a page served away from Gmail and Calendar',
    () => {
      writeStrategy(
        'claim-inflation',
        withCase({ pages: [{ kind: 'file', file: 'a.html', url: 'https://x.example/' }] }),
      );
    },
    /a Gmail or Google Calendar address/u,
  ],
  [
    'an expectation naming both claims and orphans',
    () => {
      writeStrategy(
        'claim-inflation',
        withCase({ expect: [{ claims: {}, orphans: true, allowed: ['UNASKED'] }] }),
      );
    },
    /name either claims or orphans/u,
  ],
  [
    'two strategies with one number',
    () => {
      writeStrategy('claim-inflation', INFLATION);
      writeStrategy('paraphrase-drift', { ...INFLATION, strategy: 'paraphrase-drift' });
    },
    /two strategies share a number/u,
  ],
];

describe('a bad fixture fails naming its file', () => {
  it('refuses a missing attacks folder, so a mistyped path is never an empty report', () => {
    expect(() => loadAttacks(path.join(dir, 'missing'))).toThrow(/no attacks folder/u);
  });

  it.each(BAD_FIXTURES)('%s', (_, write, message) => {
    write();
    expect(() => loadAttacks(dir)).toThrow(message);
  });
});

describe('metric names', () => {
  it('carry the number and the name', () => {
    expect(prefixOf({ number: 3, strategy: 'counterparty-confusables' })).toBe(
      'redteam03CounterpartyConfusables',
    );
    expect(reportMetrics([])).toEqual({ redteamStrategies: 0, redteamCases: 0, redteamWorking: 0 });
  });
});

describe('pnpm redteam', () => {
  it('is registered with the other benches, so pnpm bench runs it too', () => {
    expect(BENCHES.map((bench) => bench.name)).toContain('redteam');
  });

  it('runs the red team alone with --only redteam, every bench without it, and refuses a name nothing has', () => {
    expect(selectedBenches(BENCHES, ['--only', 'redteam']).map((bench) => bench.name)).toEqual(['redteam']);
    expect(selectedBenches(BENCHES, [])).toBe(BENCHES);
    expect(() => selectedBenches(BENCHES, ['--only', 'red-team'])).toThrow(/no bench is named red-team/u);
    expect(() => selectedBenches(BENCHES, ['--only'])).toThrow(/no bench is named \(none given\)/u);
  });
});
