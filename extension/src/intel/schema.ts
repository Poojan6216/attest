/**
 * What the advisory model may answer (sprint_5 5.1; agents/intel_engineer.md rules 1 and 3): `{scores: [{candidateId,
 * score, rationaleHint?}]}`, a score in [0, 1] for candidates it was given, and a hint of at most 80 characters on one
 * line, which Attest never shows, stores or logs. Anything else is no answer: a key no schema names, a score outside
 * [0, 1], a candidate it was not given, a candidate scored twice. `scoresOf` turns a valid answer into the grading
 * context's model scores (integer basis points, one per candidate, in id order; docs/grading.md §5.4).
 */
import { z } from 'zod';

import { type GradeContext, SCHEMA_LIMITS, Ulid } from '../core/schema';
import { oneLineText } from '../core/schema-text';
import { BASIS_POINTS } from '../core/units';
import type { IntelInput } from './input';

const RATIONALE_HINT_MAX = SCHEMA_LIMITS.SUBJECT_HINT;

export const IntelScore = z.strictObject({
  candidateId: Ulid,
  score: z.number().min(0).max(1),
  rationaleHint: oneLineText(RATIONALE_HINT_MAX).optional(),
});

export const IntelOutput = z.strictObject({ scores: z.array(IntelScore).max(SCHEMA_LIMITS.BATCH) });

export type IntelOutput = z.infer<typeof IntelOutput>;

/**
 * The answer's shape as a JSON Schema, written out, for a model that can be held to one (the built-in model's
 * `responseConstraint`). Written by hand because the shipped build carries no zod JSON Schema code (wxt.config.ts);
 * tests/unit/intel/builtin.spec.ts holds it to `IntelOutput`.
 */
export const INTEL_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidateId: { type: 'string' },
          score: { type: 'number', minimum: 0, maximum: 1 },
          rationaleHint: { type: 'string', maxLength: RATIONALE_HINT_MAX },
        },
        required: ['candidateId', 'score'],
        additionalProperties: false,
      },
    },
  },
  required: ['scores'],
  additionalProperties: false,
} as const;
export type ModelScores = NonNullable<GradeContext['modelScores']>;

/** A model's answer as JSON, or the text itself when it is not JSON (`scoresOf` then reads it as no answer). */
export function parsedOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * The model scores an answer gives `input`'s candidates, in basis points and id order; null when the answer is not
 * an `IntelOutput`, names a candidate it was not given, or scores one twice. A candidate it leaves out has no score.
 */
export function scoresOf(answer: unknown, input: IntelInput): ModelScores | null {
  const parsed = IntelOutput.safeParse(answer);
  if (!parsed.success) return null;
  const given = new Set(input.candidates.map(({ id }) => id));
  const ids = parsed.data.scores.map(({ candidateId }) => candidateId);
  if (ids.some((id) => !given.has(id)) || new Set(ids).size !== ids.length) return null;
  return parsed.data.scores
    .map(({ candidateId, score }) => ({
      observationId: candidateId,
      score: Math.round(score * BASIS_POINTS),
    }))
    .sort((a, b) => (a.observationId < b.observationId ? -1 : 1));
}
