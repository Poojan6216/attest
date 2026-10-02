/**
 * The golden suite (docs/grading.md §15; sprint 1 task 1.5): every scenario file in tests/golden is run through
 * the core exactly as the README's runner contract says (mode batch → gradeBatch, mode grade → grade, then the
 * scenario's events through state.ts `transition`), and every receipt is compared with the hand-computed
 * expectation: grade, ruleId, state, observationIds, the exact score, reason codes (and params when asserted),
 * agent, attribution, override and supersession, plus the generic computedAt/finalAt/schema checks. A missing
 * or an extra receipt fails.
 *
 * A failing scenario prints its file, its name, and one line per disagreement, naming the subject by ref:
 *   `c1 ruleId: expected "verified", got "partial"`.
 *
 * The runner is itself tested: each comparison is shown to report a broken expectation or a broken receipt.
 */
import { describe, expect, it } from 'vitest';

import { IsoTs, type Reason, type Receipt } from '../../src/core/schema';
import { type LoadedScenario, loadScenario, type ResolvedExpect, scenarioFiles } from './load';
import { diffScenario, runScenario, type ScenarioRun } from './runner';
import type { ExpectedReceipt } from './scenario-schema';

const FILES = scenarioFiles();

describe('golden scenarios (docs/grading.md §15)', () => {
  it('has at least 77 scenarios (sprint 1: 40+; every file in tests/golden is run)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(77);
  });

  it.each(FILES)('%s', async (file) => {
    const loaded = loadScenario(file);
    const run = await runScenario(loaded);
    expect(diffScenario(loaded, run), `${file}: ${loaded.scenario.name}`).toEqual([]);
  });
});

/** The scenario with one expectation (the one for `ref`) changed; its reason params are no longer asserted. */
function withExpected(loaded: LoadedScenario, ref: string, patch: Partial<ExpectedReceipt>): LoadedScenario {
  const expected = loaded.expected.map((entry): ResolvedExpect => {
    if (entry.expected.ref !== ref) return entry;
    const changed: ResolvedExpect = { ...entry, expected: { ...entry.expected, ...patch } };
    delete changed.reasons;
    return changed;
  });
  return { ...loaded, expected };
}

/** The run with the receipt of `id` changed (a broken implementation's output). */
function withReceipt(run: ScenarioRun, id: string, patch: (receipt: Receipt) => Receipt): ScenarioRun {
  return { ...run, receipts: run.receipts.map((receipt) => (receipt.id === id ? patch(receipt) : receipt)) };
}

function idOf(loaded: LoadedScenario, ref: string): string {
  const entry = loaded.expected.find((candidate) => candidate.expected.ref === ref);
  if (entry === undefined) throw new Error(`no expectation for ${ref}`);
  return entry.receiptId;
}

/** 13, the §2 demo: c1 VERIFIED 12/13 with o1, c2 NOT_FOUND with asserted params, o2 UNASKED 7/10. */
let demoRun: Promise<readonly [LoadedScenario, ScenarioRun]> | undefined;
function demo(): Promise<readonly [LoadedScenario, ScenarioRun]> {
  demoRun ??= (async () => {
    const loaded = loadScenario('13-demo-section-2.json');
    return [loaded, await runScenario(loaded)] as const;
  })();
  return demoRun;
}

const MUTATIONS: readonly (readonly [string, Partial<ExpectedReceipt>, string])[] = [
  ['c1', { grade: 'PARTIAL' }, 'c1 grade: expected "PARTIAL", got "VERIFIED"'],
  ['c1', { ruleId: 'partial' }, 'c1 ruleId: expected "partial", got "verified"'],
  ['c1', { state: 'PENDING' }, 'c1 state: expected "PENDING", got "FINAL"'],
  ['c1', { score: '1/1' }, 'c1 score: expected "1/1", got "12/13"'],
  ['c2', { reasonCodes: ['match.none', 'coverage.account_unbound'] }, 'c2 reasonCodes: expected'],
  ['o2', { attributionScore: '3/5' }, 'o2 attributionScore: expected "3/5", got "7/10"'],
  ['o2', { agent: 'chatgpt' }, 'o2 agent: expected "chatgpt", got "muse"'],
  ['c1', { override: 'VERIFIED' }, 'c1 override.grade: expected "VERIFIED", got absent'],
];

describe('the golden runner reports a wrong expectation (so it fails when the core disagrees)', () => {
  it('passes the unmodified scenario', async () => {
    const [loaded, run] = await demo();
    expect(diffScenario(loaded, run)).toEqual([]);
  });

  it.each(MUTATIONS)('%s %o', async (ref, patch, line) => {
    const [loaded, run] = await demo();
    expect(diffScenario(withExpected(loaded, ref, patch), run).join('\n')).toContain(line);
  });

  it('compares evidence and asserted reason params', async () => {
    const [loaded, run] = await demo();
    const noEvidence = { ...loaded, expected: loaded.expected.map((e) => ({ ...e, observationIds: [] })) };
    expect(diffScenario(noEvidence, run)).toContain('c1 observationIds: expected [], got ["o1"]');
    const wrong: Reason[] = [{ code: 'coverage.account_unbound', params: { source: 'gmail.sent' } }];
    const tampered = {
      ...loaded,
      expected: loaded.expected.map((e) => (e.expected.ref === 'c2' ? { ...e, reasons: wrong } : e)),
    };
    expect(diffScenario(tampered, run).join('\n')).toContain('c2 reasons: expected');
  });

  it('compares override and supersession after the events (56, 57)', async () => {
    const overridden = loadScenario('56-user-override.json');
    const overrideRun = await runScenario(overridden);
    expect(diffScenario(overridden, overrideRun)).toEqual([]);
    const previous = withExpected(overridden, 'c1', { previousState: 'PENDING' });
    expect(diffScenario(previous, overrideRun)).toContain(
      'c1 override.previousState: expected "PENDING", got "FINAL"',
    );
    const superseded = loadScenario('57-unasked-superseded.json');
    const expected = superseded.expected.map((e) => {
      const copy = { ...e };
      delete copy.supersededById;
      return copy;
    });
    const lines = diffScenario({ ...superseded, expected }, await runScenario(superseded));
    expect(lines.join('\n')).toContain('o1 supersededBy: expected absent, got');
  });
});

describe('the golden runner reports a wrong receipt (so it fails when the core is broken)', () => {
  it('reports a missing receipt and an unexpected one', async () => {
    const [loaded, run] = await demo();
    const withoutO2 = { ...loaded, expected: loaded.expected.filter((e) => e.expected.ref !== 'o2') };
    expect(diffScenario(withoutO2, run)).toContain('o2: unexpected UNASKED receipt (rule unasked, FINAL)');
    const dropped = { ...run, receipts: run.receipts.filter((r) => r.id !== idOf(loaded, 'c2')) };
    expect(diffScenario(loaded, dropped)).toContain(
      'c2: expected a NOT_FOUND receipt (rule not_found), got none',
    );
  });

  it('checks every receipt: computedAt, finalAt, the claim agent, UNASKED "likely", the schema', async () => {
    const [loaded, run] = await demo();
    const lines = (patched: ScenarioRun) => diffScenario(loaded, patched).join('\n');
    const c1 = idOf(loaded, 'c1');
    const o2 = idOf(loaded, 'o2');
    const earlier = IsoTs.parse('2026-10-06T14:00:00-04:00');
    expect(lines(withReceipt(run, c1, (r) => ({ ...r, computedAt: earlier })))).toContain(
      'c1 computedAt: expected',
    );
    expect(lines(withReceipt(run, c1, (r) => ({ ...r, finalAt: undefined })))).toContain(
      'c1 finalAt: expected',
    );
    const otherAgent = lines(withReceipt(run, c1, (r) => ({ ...r, agent: 'dots' })));
    expect(otherAgent).toContain('c1 agent (the claim\'s): expected "muse", got "dots"');
    expect(lines(withReceipt(run, c1, (r) => ({ ...r, claimId: undefined })))).toContain(
      'c1 claimId: expected "',
    );
    expect(lines(withReceipt(run, o2, (r) => ({ ...r, claimId: loaded.claims.get('c1')?.id })))).toContain(
      'o2 claimId: expected absent, got "',
    );
    expect(lines(withReceipt(run, c1, (r) => ({ ...r, policyHash: r.inputsHash })))).toContain(
      'c1 policyHash: expected "',
    );
    const unlabelled = lines(withReceipt(run, o2, (r) => ({ ...r, attribution: undefined })));
    expect(unlabelled).toContain('o2 attribution: expected "likely", got absent');
    expect(unlabelled).toContain('o2: not a valid Receipt');
  });
});
