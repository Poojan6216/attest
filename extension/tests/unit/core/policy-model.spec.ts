/**
 * The loader's rules for the model's weight (docs/grading.md §5.4, v1.19; sprint_5 5.0): `modelScore` is never a pair
 * feature, so no type lists it and none names it as identity, and its weight is capped so that the model alone never
 * makes a match at the partial floor verified, λ·(1 − partial) < verified − partial. Every problem names its path.
 */
import { describe, expect, it } from 'vitest';

import { loadPolicy } from '../../../src/core/policy';
import { type Edit, edited, issuesOf, type Segment } from './policy-edit';

const ZERO_SUM = 'the weights of the listed features must sum to more than 0';
const MODEL_LISTED = '"modelScore" is never listed by type: the model only raises a match (§5.4)';
const CAP =
  'features.modelScore: must be < (verified − partial) / (1 − partial): the model alone never makes a partial match verified';

type Case = readonly [name: string, edits: readonly Edit[], expected: readonly string[]];
const one = (name: string, path: readonly Segment[], value: unknown, ...expected: string[]): Case => [
  name,
  [[path, value]],
  expected,
];

const CASES: readonly Case[] = [
  one(
    'modelScore listed for a type (the model only raises a match, §5.4)',
    ['featuresByType', 'other'],
    ['timeProximity', 'subjectOverlap', 'modelScore'],
    `featuresByType.other[2]: ${MODEL_LISTED}`,
  ),
  [
    'modelScore named as identity, and weighing nothing in a type alone',
    [
      [['featuresByType', 'other'], ['modelScore']],
      [['identityFeatures', 'other'], ['modelScore']],
    ],
    [
      `featuresByType.other[0]: ${MODEL_LISTED}`,
      `featuresByType.other: ${ZERO_SUM}`,
      `identityFeatures.other[0]: ${MODEL_LISTED}`,
    ],
  ],
  one(
    'model weight at its cap: (verified − partial) / (1 − partial) = 0.7 under the shipped thresholds',
    ['features', 'modelScore'],
    0.7,
    CAP,
  ),
  one('model weight 1', ['features', 'modelScore'], 1, CAP),
  ['a model weight under thresholds 0.84 and 0.85 (cap 0.0625)', [[['thresholds', 'partial'], 0.84]], [CAP]],
];

describe('loadPolicy: the model is never a pair feature, and its weight is capped (v1.19)', () => {
  it.each(CASES)('%s', (_name, edits, expected) => {
    expect(issuesOf(edited(...edits))).toEqual(expected);
  });

  it('loads the shipped 0.15, any weight just under the cap, and 0', () => {
    expect(loadPolicy(edited()).bp.features.modelScore).toBe(1500);
    expect(loadPolicy(edited([['features', 'modelScore'], 0.6999])).bp.features.modelScore).toBe(6999);
    expect(loadPolicy(edited([['features', 'modelScore'], 0])).bp.features.modelScore).toBe(0);
    const tight = edited([['thresholds', 'partial'], 0.84], [['features', 'modelScore'], 0.0624]);
    expect(loadPolicy(tight).bp.features.modelScore).toBe(624);
  });
});
