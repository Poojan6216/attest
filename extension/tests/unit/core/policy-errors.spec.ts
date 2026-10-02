/**
 * Policy v2, malformed documents (1/2): windows, weights and thresholds, and the per-ActionType maps
 * (docs/grading.md §5.1–§5.3, §12). Every case lists the full expected issues, each naming its path, so a
 * check that disappears or reports the wrong path fails here. Lists, rules, unasked and allowlisted fields:
 * policy-errors-lists.spec.ts.
 */
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import { loadPolicy, PolicyError } from '../../../src/core/policy';
import { MS_PER_DAY, MS_PER_MINUTE } from '../../../src/core/units';

type Segment = string | number;
type Edit = readonly [path: readonly Segment[], value: unknown];

const REMOVE = Symbol('remove');

/** A copy of the shipped policy with each edit applied (REMOVE deletes the key). */
function edited(...edits: readonly Edit[]): unknown {
  const doc: unknown = structuredClone(policyJson);
  for (const [path, value] of edits) {
    let parent = doc as Record<Segment, unknown>;
    for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<Segment, unknown>;
    const last = path.at(-1);
    if (last === undefined) throw new Error('an edit needs a path');
    if (value === REMOVE) Reflect.deleteProperty(parent, last);
    else parent[last] = value;
  }
  return doc;
}

function issuesOf(raw: unknown): readonly string[] {
  try {
    loadPolicy(raw);
  } catch (error) {
    if (error instanceof PolicyError) return error.issues;
    throw error;
  }
  throw new Error('expected loadPolicy to throw a PolicyError');
}

const MULTIPLE = 'must be a multiple of 0.0001';
const ZERO_SUM = 'the weights of the listed features must sum to more than 0';

type Case = readonly [name: string, edits: readonly Edit[], expected: readonly string[]];
const one = (name: string, path: readonly Segment[], value: unknown, ...expected: string[]): Case => [
  name,
  [[path, value]],
  expected,
];

const WINDOW_CASES: readonly Case[] = [
  one(
    'tolerance = beforeClaimMin',
    ['windows', 'toleranceMin'],
    2,
    'windows.toleranceMin: must be < windows.beforeClaimMin',
  ),
  one(
    'tolerance = afterClaimMin',
    ['windows', 'afterClaimMin'],
    1,
    'windows.toleranceMin: must be < windows.afterClaimMin',
  ),
  one(
    'zero calendar days',
    ['windows', 'calendarDays'],
    0,
    'windows.toleranceMin: must be < windows.calendarDays (in minutes)',
  ),
  [
    'tolerance = calendarDays converted to minutes (3 days = 4320 min)',
    [
      [['windows', 'beforeClaimMin'], 5000],
      [['windows', 'afterClaimMin'], 5000],
      [['windows', 'toleranceMin'], 4320],
    ],
    ['windows.toleranceMin: must be < windows.calendarDays (in minutes)'],
  ],
  one('fractional minutes', ['windows', 'graceMin'], 0.5, 'windows.graceMin: must be an integer'),
  one(
    'missing spendWindowDays',
    ['windows', 'spendWindowDays'],
    REMOVE,
    'windows.spendWindowDays: is required',
  ),
  one(
    'negative finalize hours',
    ['windows', 'finalizeUnverifiableHours'],
    -1,
    'windows.finalizeUnverifiableHours: must be >= 0',
  ),
  one(
    'unsafe integer window',
    ['windows', 'spendWindowDays'],
    2 ** 60,
    'windows.spendWindowDays: must be <= 9007199254740991',
    'windows.spendWindowDays: must be <= 104249991',
  ),
  // Every window must be a safe integer of milliseconds (2^53 − 1 ms), in its own unit.
  one(
    'calendar days past 2^53 ms',
    ['windows', 'calendarDays'],
    104_249_992,
    'windows.calendarDays: must be <= 104249991',
  ),
  one(
    'finalize hours past 2^53 ms',
    ['windows', 'finalizeUnverifiableHours'],
    2_501_999_793,
    'windows.finalizeUnverifiableHours: must be <= 2501999792',
  ),
  one(
    'grace minutes past 2^53 ms',
    ['windows', 'graceMin'],
    150_119_987_580,
    'windows.graceMin: must be <= 150119987579',
  ),
];

const WEIGHT_CASES: readonly Case[] = [
  one(
    'weight with 5 decimal places',
    ['features', 'counterpartyName'],
    0.12345,
    `features.counterpartyName: ${MULTIPLE}`,
  ),
  one(
    'reserved modelScore below 0',
    ['features', 'modelScore'],
    -0.0001,
    'features.modelScore: must be >= 0',
  ),
  one('threshold off the grid', ['thresholds', 'verified'], 0.85001, `thresholds.verified: ${MULTIPLE}`),
  one(
    'threshold 0.1 + 0.2 (off the grid, and below partial)',
    ['thresholds', 'verified'],
    0.1 + 0.2,
    `thresholds.verified: ${MULTIPLE}`,
    'thresholds.partial: must be < thresholds.verified',
  ),
  one(
    'partial equal to verified',
    ['thresholds', 'partial'],
    0.85,
    'thresholds.partial: must be < thresholds.verified',
  ),
  one(
    'signal weight 0.00005',
    ['unasked', 'signals', 'userIdle'],
    0.00005,
    `unasked.signals.userIdle: ${MULTIPLE}`,
  ),
  one('unasked threshold 0.33333', ['unasked', 'threshold'], 0.33333, `unasked.threshold: ${MULTIPLE}`),
  one('weight above 1', ['features', 'amountExact'], 1.0001, 'features.amountExact: must be <= 1'),
];

const PER_TYPE_CASES: readonly Case[] = [
  one(
    'type missing from sourcesByType',
    ['sourcesByType', 'other'],
    REMOVE,
    'sourcesByType.other: is required',
  ),
  one(
    'unknown type in sourcesByType',
    ['sourcesByType', 'sms.sent'],
    [],
    'sourcesByType["sms.sent"]: unknown key',
  ),
  one(
    'unknown observation source',
    ['sourcesByType', 'email.sent', 0],
    'gmail.inbox',
    'sourcesByType["email.sent"][0]: must be one of "gmail.sent", "gmail.receipt", "gcal.event"',
  ),
  one(
    'duplicate source',
    ['sourcesByType', 'calendar.created'],
    ['gcal.event', 'gcal.event'],
    'sourcesByType["calendar.created"][1]: duplicate "gcal.event" (first at [0])',
  ),
  one(
    'unknown feature',
    ['featuresByType', 'email.sent', 4],
    'bodyMatch',
    'featuresByType["email.sent"][4]: must be a key of features',
  ),
  one(
    'type missing from featuresByType',
    ['featuresByType', 'listing.posted'],
    REMOVE,
    'featuresByType["listing.posted"]: is required',
  ),
  one(
    'listed weights sum to 0',
    ['featuresByType', 'other'],
    ['modelScore'],
    `featuresByType.other: ${ZERO_SUM}`,
  ),
  [
    'every purchase-like feature weighted 0',
    ['timeProximity', 'amountExact', 'merchantMatch', 'subjectOverlap'].map(
      (f) => [['features', f], 0] as const,
    ),
    ['purchase.made', 'subscription.changed', 'listing.posted'].map(
      (t) => `featuresByType["${t}"]: ${ZERO_SUM}`,
    ),
  ],
  one(
    'identity feature not listed for its type',
    ['identityFeatures', 'purchase.made'],
    ['amountExact', 'counterpartyExact'],
    'identityFeatures["purchase.made"][1]: "counterpartyExact" is not listed in featuresByType["purchase.made"]',
  ),
  one(
    'unknown identity feature',
    ['identityFeatures', 'email.sent', 0],
    'recipient',
    'identityFeatures["email.sent"][0]: must be a key of features',
  ),
  one(
    'type missing from identityFeatures',
    ['identityFeatures', 'message.sent'],
    REMOVE,
    'identityFeatures["message.sent"]: is required',
  ),
  one(
    'duplicate identity feature',
    ['identityFeatures', 'email.sent'],
    ['counterpartyName', 'counterpartyName'],
    'identityFeatures["email.sent"][1]: duplicate "counterpartyName" (first at [0])',
  ),
];

const CASES = [...WINDOW_CASES, ...WEIGHT_CASES, ...PER_TYPE_CASES];

describe('loadPolicy: malformed windows, weights and per-type maps name their paths', () => {
  it.each(CASES)('%s', (_name, edits, expected) => {
    expect(issuesOf(edited(...edits))).toEqual(expected);
  });

  it('the table has distinct cases and touches every windows/weights/per-type key', () => {
    expect(new Set(CASES.map(([name]) => name)).size).toBe(CASES.length);
    expect(new Set(CASES.flatMap(([, , expected]) => expected)).size).toBeGreaterThanOrEqual(15);
    const touched = new Set(CASES.flatMap(([, edits]) => edits.map(([path]) => path.slice(0, 2).join('.'))));
    for (const key of [
      'windows.toleranceMin',
      'windows.spendWindowDays',
      'windows.finalizeUnverifiableHours',
      'windows.calendarDays',
      'features.counterpartyName',
      'features.modelScore',
      'thresholds.verified',
      'unasked.signals',
      'unasked.threshold',
      'sourcesByType.email.sent',
      'featuresByType.other',
      'identityFeatures.purchase.made',
    ]) {
      expect(
        [...touched].some((path) => path.startsWith(key)),
        key,
      ).toBe(true);
    }
  });
});

describe('loadPolicy: the edges of the valid domain, and how problems are reported', () => {
  it('tolerance one minute inside calendarDays still loads (the conversion is exact)', () => {
    const doc = edited(
      [['windows', 'beforeClaimMin'], 5000],
      [['windows', 'afterClaimMin'], 5000],
      [['windows', 'toleranceMin'], 4319],
    );
    expect(loadPolicy(doc).windows.toleranceMin).toBe(4319);
  });

  it('every window loads at its largest safe value (2^53 − 1 ms, floored to its unit)', () => {
    const atCap = edited(
      [['windows', 'beforeClaimMin'], 150_119_987_579],
      [['windows', 'afterClaimMin'], 150_119_987_579],
      [['windows', 'graceMin'], 150_119_987_579],
      [['windows', 'calendarDays'], 104_249_991],
      [['windows', 'spendWindowDays'], 104_249_991],
      [['windows', 'finalizeUnverifiableHours'], 2_501_999_792],
      [['unasked', 'windows'], { sessionMin: 150_119_987_579, idleMin: 0, adjacentMin: 150_119_987_579 }],
    );
    const { windows } = loadPolicy(atCap);
    expect(windows.calendarDays * MS_PER_DAY).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(windows.graceMin * MS_PER_MINUTE).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    [null, 'null'],
    [[], 'array'],
    ['policy', 'string'],
    [42, 'number'],
  ])('a non-object document (%j) is rejected at the root', (raw, kind) => {
    expect(issuesOf(raw)).toEqual([`(root): expected object, got ${kind}`]);
  });

  it('reports every problem at once, not just the first', () => {
    expect(issuesOf(edited([['windows', 'graceMin'], -1], [['thresholds', 'verified'], 1.2]))).toEqual([
      'windows.graceMin: must be >= 0',
      'thresholds.verified: must be <= 1',
    ]);
    expect(issuesOf({})).toHaveLength(Object.keys(policyJson).length);
  });

  it('PolicyError carries a typed code, a frozen issue list, and a name', () => {
    let caught: unknown;
    try {
      loadPolicy(edited([['extra'], 1]));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PolicyError);
    if (!(caught instanceof PolicyError)) return;
    expect(caught.code).toBe('invalid_policy');
    expect(caught.name).toBe('PolicyError');
    expect(Object.isFrozen(caught.issues)).toBe(true);
    expect(caught.message).toBe('invalid policy: extra: unknown key');
  });
});
