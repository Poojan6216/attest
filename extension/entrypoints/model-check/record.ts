/**
 * The model-check page's recording for the advisory model's bench (sprint_5 5.5; bench/intel.ts): each of the bench's
 * inputs (./bench-inputs.json, generated from the labelled corpus by tests/tools/intel-inputs.ts) scored through the
 * grading's own provider and call, with its time limit (src/intel/index.ts `scoresFor`), and the answers written as
 * the recording the bench reads (bench/fixtures/intel/builtin.json): each input's hash and its scores in basis points,
 * or null when the model gave none in time. Scores only: never a hint, never an input. A development page's code
 * (wxt.config.ts DEV_ENTRYPOINTS): no release build holds it.
 */
import { z } from 'zod';

import { type IntelProvider, scoresFor } from '../../src/intel';
import { IntelInput } from '../../src/intel/input';
import type { ModelScores } from '../../src/intel/schema';
import benchInputsFile from './bench-inputs.json';

const BenchInputs = z.strictObject({
  note: z.string(),
  inputs: z.array(z.strictObject({ hash: z.string().regex(/^[0-9a-f]{64}$/u), input: IntelInput })),
});

/** The bench's inputs, each with the hash the recording keys its answer by. */
export const BENCH_INPUTS = BenchInputs.parse(benchInputsFile).inputs;

export type BenchAnswers = Record<string, ModelScores | null>;

/** Asks `provider` about every input in turn (header); `onAnswer` hears how many have been asked so far. */
export async function recordBench(
  provider: IntelProvider,
  onAnswer: (count: number) => void,
  inputs: readonly (typeof BENCH_INPUTS)[number][] = BENCH_INPUTS,
): Promise<BenchAnswers> {
  const answers: BenchAnswers = {};
  for (const [index, { hash, input }] of inputs.entries()) {
    answers[hash] = (await scoresFor(provider, input)) ?? null;
    onAnswer(index + 1);
  }
  return answers;
}

/** The recording's file, as the bench reads it (tests/unit/intel/corpus.ts `IntelRecording`). */
export function recordingOf(answers: BenchAnswers, recordedAt: string, userAgent: string): string {
  const chrome = /\bChrome\/(\d+)/u.exec(userAgent)?.[1] ?? 'unknown';
  const recording = {
    note: "Chrome's on-device model's answers to the bench's inputs, recorded on the model-check page (entrypoints/model-check/record.ts). Scores only, in basis points; null where it gave none in time.",
    provider: 'builtin',
    model: `Chrome ${chrome} on-device model`,
    recordedAt,
    answers,
  };
  return `${JSON.stringify(recording, null, 2)}\n`;
}
