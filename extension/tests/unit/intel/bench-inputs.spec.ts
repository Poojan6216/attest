/**
 * The advisory model bench's inputs and recordings (sprint_5 5.5): entrypoints/model-check/bench-inputs.json holds
 * exactly what the labelled corpus would have the service worker send (one entry per distinct input, tests/tools/
 * intel-inputs.ts writes it), the model-check page reads the same, and a recording it makes is one the bench reads
 * (tests/unit/intel/corpus.ts `IntelRecording`): every input's hash, its scores or null, and no hint or input.
 * Over a stand-in provider, never a real model. Every value is invented.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BENCH_INPUTS, recordBench, recordingOf } from '../../../entrypoints/model-check/record';
import type { IntelProvider } from '../../../src/intel';
import { BENCH_INPUTS_FILE, benchInputs } from '../../tools/intel-inputs';
import { IntelRecording } from './corpus';

const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

describe('the bench inputs', () => {
  it('are what the labelled corpus asks, and what the model-check page reads', async () => {
    const committed: unknown = JSON.parse(readFileSync(BENCH_INPUTS_FILE, 'utf8'));
    // Run `pnpm exec tsx tests/tools/intel-inputs.ts` from extension/ when the corpus changes.
    expect(committed).toEqual(await benchInputs());
    expect(BENCH_INPUTS).toEqual((await benchInputs()).inputs);
    expect(BENCH_INPUTS).toHaveLength(16);
  });
});

describe('a recording', () => {
  it('holds each input’s scores or null, keyed by its hash, as the bench reads it', async () => {
    let asked = 0;
    const provider: IntelProvider = {
      id: 'builtin',
      score: (input) => {
        asked += 1;
        // Every third input unanswered, as a model that ran out of time.
        if (asked % 3 === 0) return Promise.resolve('no JSON here');
        return Promise.resolve({
          scores: input.candidates.map(({ id }) => ({
            candidateId: id,
            score: 0.9,
            rationaleHint: 'same words',
          })),
        });
      },
    };
    const counts: number[] = [];
    const answers = await recordBench(provider, (count) => counts.push(count));
    expect(counts).toEqual(BENCH_INPUTS.map((_, index) => index + 1));
    const recording = IntelRecording.parse(
      JSON.parse(recordingOf(answers, '2026-10-12T10:00:00.000-04:00', UA)),
    );
    expect(recording).toMatchObject({ provider: 'builtin', model: 'Chrome 154 on-device model' });
    expect(Object.keys(recording.answers)).toEqual(BENCH_INPUTS.map(({ hash }) => hash));
    const values = Object.values(recording.answers);
    expect(values.filter((value) => value === null)).toHaveLength(Math.floor(BENCH_INPUTS.length / 3));
    expect(values.find((value) => value !== null)?.[0]?.score).toBe(9_000);
    expect(JSON.stringify(recording)).not.toContain('same words');
  });
});
