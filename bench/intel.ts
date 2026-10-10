/**
 * The advisory model's bench (sprint_5 5.5; agents/intel_engineer.md rule 8; Hard Rule 12): precision and recall of
 * VERIFIED on the labelled matching corpus (extension/tests/unit/intel/corpus.ts), graded by the rules alone and with
 * each model whose answers are recorded under bench/fixtures/intel/: builtin.json (Chrome's on-device model, from the
 * model-check page) and byo-anthropic.json, byo-openai.json (a person's own key, from bench/intel-record.ts). A model
 * with no recording is reported as not measured, never as a number. `intelModelHelps` is true only when a measured
 * model verifies more labelled cases with no more false verifications, or fewer false ones with no fewer true: the bar
 * for turning a model on by default (sprint_5 5.5: a model that does not improve precision at equal recall stays off
 * by default). Every case and every input is invented, and the result says so.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IntelRecording, type IntelScore, scoreCorpus } from '../extension/tests/unit/intel/corpus';
import type { MetricValue } from './results';

/** Where the recordings are. */
export const INTEL_FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'intel');

/** Each recording the bench reads, and the name its metrics carry. */
export const RECORDINGS = [
  { name: 'Builtin', file: 'builtin.json' },
  { name: 'ByoAnthropic', file: 'byo-anthropic.json' },
  { name: 'ByoOpenai', file: 'byo-openai.json' },
] as const;

const fourPlaces = (value: number): number => Math.round(value * 10_000) / 10_000;

/** One score's metrics under `prefix`. */
function metricsOf(prefix: string, score: IntelScore): Record<string, MetricValue> {
  return {
    [`${prefix}VerifiedTrue`]: score.verifiedTrue,
    [`${prefix}VerifiedFalse`]: score.verifiedFalse,
    [`${prefix}Precision`]: score.precision === null ? 'none verified' : fourPlaces(score.precision),
    [`${prefix}Recall`]: fourPlaces(score.recall),
  };
}

/** Whether `model` is better than `rules` (header): no fewer true and no more false verifications, one of them strictly. */
export function modelHelps(rules: IntelScore, model: IntelScore): boolean {
  const noWorse = model.verifiedTrue >= rules.verifiedTrue && model.verifiedFalse <= rules.verifiedFalse;
  return noWorse && (model.verifiedTrue > rules.verifiedTrue || model.verifiedFalse < rules.verifiedFalse);
}

export async function runIntelBench(
  dir: string = INTEL_FIXTURES,
): Promise<Readonly<Record<string, MetricValue>>> {
  const rules = await scoreCorpus();
  const metrics: Record<string, MetricValue> = {
    intelCases: rules.cases,
    intelLabelled: rules.labelled,
    intelAsked: rules.asked,
    ...metricsOf('intelRules', rules),
  };
  let helps = false;
  for (const { name, file } of RECORDINGS) {
    const at = path.join(dir, file);
    if (!existsSync(at)) {
      metrics[`intel${name}Measured`] = false;
      continue;
    }
    const recording = IntelRecording.parse(JSON.parse(readFileSync(at, 'utf8')));
    const score = await scoreCorpus((hash) => recording.answers[hash]);
    Object.assign(metrics, {
      [`intel${name}Measured`]: true,
      [`intel${name}Model`]: recording.model,
      [`intel${name}RecordedAt`]: recording.recordedAt,
      [`intel${name}Answered`]: score.answered,
      ...metricsOf(`intel${name}`, score),
    });
    helps ||= modelHelps(rules, score);
  }
  metrics.intelModelHelps = helps;
  metrics.intelCorpusInvented = true;
  return metrics;
}
