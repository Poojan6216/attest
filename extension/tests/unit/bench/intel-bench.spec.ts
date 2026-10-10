/**
 * The advisory model's bench (bench/intel.ts; sprint_5 5.5; Hard Rule 12): registered with `pnpm bench`; the rules'
 * numbers on the labelled corpus; a model with no recording reported as not measured, never as a number; a recording
 * read and scored; and `intelModelHelps` true only for a model that verifies more with no false verification added.
 * The recordings here are stand-ins written by the test, never a real model's. Every value is invented.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { modelHelps, RECORDINGS, runIntelBench } from '../../../../bench/intel';
import { BENCHES } from '../../../../bench/run_bench';
import { BASIS_POINTS } from '../../../src/core/units';
import { askedInputs, type IntelScore, readIntelCorpus, truthIdOf } from '../intel/corpus';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'attest-intel-bench-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in recording, every asked input's candidate scored by `score`, written as `file` in the test's folder. */
async function standIn(
  file: string,
  score: (truth: string | null, candidateId: string) => number,
): Promise<void> {
  const cases = readIntelCorpus();
  const answers: Record<string, { observationId: string; score: number }[]> = {};
  for (const ask of await askedInputs(cases)) {
    const intelCase = cases.find(({ id }) => id === ask.caseId);
    if (intelCase === undefined) throw new Error(`no case ${ask.caseId}`);
    answers[ask.hash] = ask.input.candidates.map(({ id }) => ({
      observationId: id,
      score: score(truthIdOf(intelCase), id) * BASIS_POINTS,
    }));
  }
  const recording = {
    note: 'A stand-in written by tests/unit/bench/intel-bench.spec.ts, never a real model.',
    provider: file === 'builtin.json' ? 'builtin' : 'byo',
    model: 'stand-in',
    recordedAt: '2026-10-12T10:00:00.000-04:00',
    answers,
  };
  writeFileSync(path.join(dir, file), JSON.stringify(recording));
}

describe('the intel bench', () => {
  it('is registered, and with no recording reports the rules alone and every model as not measured', async () => {
    expect(BENCHES.map(({ name }) => name)).toContain('intel');
    expect(await runIntelBench(dir)).toEqual({
      intelCases: 24,
      intelLabelled: 14,
      intelAsked: 17,
      intelRulesVerifiedTrue: 5,
      intelRulesVerifiedFalse: 0,
      intelRulesPrecision: 1,
      intelRulesRecall: 0.3571,
      intelBuiltinMeasured: false,
      intelByoAnthropicMeasured: false,
      intelByoOpenaiMeasured: false,
      intelModelHelps: false,
      intelCorpusInvented: true,
    });
  });

  it('scores a recording it finds, and says the model helps only when it verifies more and nothing falsely', async () => {
    await standIn('builtin.json', (truth, id) => (truth === id ? 1 : 0));
    await standIn('byo-anthropic.json', () => 1);
    const metrics = await runIntelBench(dir);
    expect(metrics).toMatchObject({
      intelBuiltinMeasured: true,
      intelBuiltinModel: 'stand-in',
      intelBuiltinAnswered: 17,
      intelBuiltinVerifiedFalse: 0,
      intelBuiltinPrecision: 1,
      intelByoAnthropicMeasured: true,
      intelByoOpenaiMeasured: false,
      intelModelHelps: true,
    });
    expect(metrics.intelBuiltinRecall).toBeGreaterThan(0.3571);
    expect(metrics.intelByoAnthropicVerifiedFalse).toBeGreaterThan(0);
  });

  it('a model that verifies more but also falsely does not help', async () => {
    await standIn('byo-openai.json', () => 1);
    expect((await runIntelBench(dir)).intelModelHelps).toBe(false);
    expect(RECORDINGS.map(({ file }) => file)).toEqual([
      'builtin.json',
      'byo-anthropic.json',
      'byo-openai.json',
    ]);
  });
});

describe('modelHelps', () => {
  const score = (verifiedTrue: number, verifiedFalse: number): IntelScore => ({
    cases: 24,
    labelled: 14,
    asked: 17,
    answered: 17,
    verifiedTrue,
    verifiedFalse,
    precision: verifiedTrue + verifiedFalse === 0 ? null : verifiedTrue / (verifiedTrue + verifiedFalse),
    recall: verifiedTrue / 14,
  });

  it('is true for more right with none more wrong, or fewer wrong with none fewer right, and false otherwise', () => {
    expect(modelHelps(score(5, 1), score(6, 1))).toBe(true);
    expect(modelHelps(score(5, 1), score(5, 0))).toBe(true);
    expect(modelHelps(score(5, 0), score(5, 0))).toBe(false);
    expect(modelHelps(score(5, 0), score(9, 1))).toBe(false);
    expect(modelHelps(score(5, 1), score(4, 0))).toBe(false);
  });
});
