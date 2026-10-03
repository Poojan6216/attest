/**
 * Policy v2: the schema is strict at EVERY level, requires every key the shipped document has, types
 * every value, and accepts the whole valid domain. These tests walk policy/default.json itself, so
 * loosening any level (z.object for z.strictObject, a partial record), making any key optional, or
 * widening any type fails here, not only at the paths the hand-written table in policy-errors.spec.ts names.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import { ConditionName, FeatureName, loadPolicy, PolicyError, ThresholdName } from '../../../src/core/policy';
import { ActionType } from '../../../src/core/schema';
import { BASIS_POINTS, MS_PER_DAY, MS_PER_MINUTE } from '../../../src/core/units';

type PathSegment = string | number;
type Path = readonly PathSegment[];
type Container = Record<PathSegment, unknown>;

interface Entry {
  readonly path: Path;
  readonly value: unknown;
}

const UNKNOWN_KEY = 'zzNotAPolicyKey';

/** The documented issue-path format: `rules[3].when.bestScoreGte`, `allowlistedFields["gmail.sent"][1]`. */
function pathText(path: Path): string {
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) return `[${JSON.stringify(segment)}]`;
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
}

const isPlainObject = (value: unknown): value is Container =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every value inside the shipped policy, with its path (the root itself excluded). */
function walk(value: unknown, path: Path = [], found: Entry[] = []): Entry[] {
  if (path.length > 0) found.push({ path, value });
  if (Array.isArray(value)) value.forEach((child: unknown, index) => walk(child, [...path, index], found));
  else if (isPlainObject(value))
    Object.entries(value).forEach(([key, child]) => walk(child, [...path, key], found));
  return found;
}

/** A copy of the shipped policy with `change` applied to the parent of `path`. */
function edited(path: Path, change: (parent: Container, key: PathSegment) => void): unknown {
  const doc: unknown = structuredClone(policyJson);
  const key = path.at(-1);
  if (key === undefined || !isPlainObject(doc)) throw new Error('edited needs a non-empty path');
  let parent: Container = doc;
  for (const segment of path.slice(0, -1)) {
    const next = parent[segment];
    if (typeof next !== 'object' || next === null) throw new Error(`no container at ${pathText(path)}`);
    parent = next as Container;
  }
  change(parent, key);
  return doc;
}

const setTo = (path: Path, value: unknown): unknown =>
  edited(path, (parent, key) => {
    parent[key] = value;
  });

const removed = (path: Path): unknown => edited(path, (parent, key) => Reflect.deleteProperty(parent, key));

function issuesOf(raw: unknown): readonly string[] {
  try {
    loadPolicy(raw);
  } catch (error) {
    if (error instanceof PolicyError) return error.issues;
    throw error;
  }
  throw new Error('expected loadPolicy to throw a PolicyError');
}

/** Keys of a rule's `when` are optional conditions; every other object key in the policy is required. */
const isCondition = (path: Path): boolean => path.length === 4 && path[0] === 'rules' && path[2] === 'when';

const ENTRIES = walk(policyJson);
const OBJECT_PATHS: readonly Path[] = [
  [],
  ...ENTRIES.filter((e) => isPlainObject(e.value)).map((e) => e.path),
];
const REQUIRED_KEYS = ENTRIES.filter((e) => typeof e.path.at(-1) === 'string' && !isCondition(e.path));
const NUMBERS = ENTRIES.filter((e) => typeof e.value === 'number');
const STRINGS = ENTRIES.filter((e) => typeof e.value === 'string');
const CONDITIONS = ENTRIES.filter((e) => isCondition(e.path));

const label = (path: Path): string => (path.length === 0 ? '(root)' : pathText(path));

describe('policy schema: strict at every level', () => {
  it('the walk reaches every level of the document', () => {
    const seen = OBJECT_PATHS.map(label);
    for (const level of [
      '(root)',
      'windows',
      'thresholds',
      'features',
      'sourcesByType',
      'featuresByType',
      'identityFeatures',
      'normalize',
      'rules[0]',
      'rules[13].when',
      'unasked',
      'unasked.signals',
      'unasked.windows',
      'unasked.signatures',
      'allowlistedFields',
    ]) {
      expect(seen).toContain(level);
    }
  });

  it.each(OBJECT_PATHS.map((path) => [label(path), path] as const))(
    'an unknown key inside %s is rejected',
    (_label, path) => {
      const where = [...path, UNKNOWN_KEY];
      expect(issuesOf(setTo(where, true))).toEqual([`${pathText(where)}: unknown key`]);
    },
  );
});

describe('policy schema: every key of the shipped document is required', () => {
  it.each(REQUIRED_KEYS.map((entry) => [pathText(entry.path), entry.path] as const))(
    'removing %s is reported as required',
    (where, path) => {
      expect(issuesOf(removed(path))).toEqual([`${where}: is required`]);
    },
  );
});

describe('policy schema: every value is typed', () => {
  it.each(NUMBERS.map((entry) => [pathText(entry.path), entry.path] as const))(
    '%s rejects a string and a value below its floor',
    (where, path) => {
      expect(issuesOf(setTo(path, '1'))).toEqual([`${where}: expected number, got string`]);
      const floor = where === 'version' ? 1 : 0;
      expect(issuesOf(setTo(path, floor - 1))).toContain(`${where}: must be >= ${floor}`);
    },
  );

  it.each(STRINGS.map((entry) => [pathText(entry.path), entry.path] as const))(
    '%s rejects a number, at its own path only',
    (where, path) => {
      const issues = issuesOf(setTo(path, 42));
      expect(issues).toHaveLength(1);
      expect(issues[0]?.startsWith(`${where}: `)).toBe(true);
    },
  );

  it('every condition the schema knows appears in the shipped rules (so the next test covers each)', () => {
    const keys = new Set(CONDITIONS.map((entry) => entry.path.at(-1)));
    expect([...keys].sort()).toEqual([...ConditionName.options].sort());
  });

  it.each(CONDITIONS.map((entry) => [pathText(entry.path), entry.path, entry.value] as const))(
    'condition %s rejects a value of the wrong kind',
    (where, path, value) => {
      if (typeof value === 'boolean') {
        expect(issuesOf(setTo(path, 'true'))).toEqual([`${where}: expected boolean, got string`]);
      } else if (path.at(-1) === 'coverage') {
        expect(issuesOf(setTo(path, 'all'))).toEqual([`${where}: must be one of "none", "partial", "full"`]);
      } else {
        expect(issuesOf(setTo(path, 'certain'))).toEqual([`${where}: must be one of "verified", "partial"`]);
      }
    },
  );
});

describe('policy schema: vocabularies match the document', () => {
  it('threshold and feature names are exactly the keys the policy defines', () => {
    expect([...ThresholdName.options].sort()).toEqual(Object.keys(policyJson.thresholds).sort());
    expect([...FeatureName.options].sort()).toEqual(Object.keys(policyJson.features).sort());
  });
});

/** Any weight on the basis-point grid. */
const weight = fc.integer({ min: 0, max: BASIS_POINTS }).map((k) => k / BASIS_POINTS);
const weights = (keys: readonly string[]) => fc.record(Object.fromEntries(keys.map((key) => [key, weight])));
const MINUTES_PER_DAY = MS_PER_DAY / MS_PER_MINUTE;

/** Whole-unit windows whose tolerance is strictly inside every edge (§5.1). */
const windows = fc
  .record({
    beforeClaimMin: fc.integer({ min: 1, max: 100_000 }),
    afterClaimMin: fc.integer({ min: 1, max: 100_000 }),
    graceMin: fc.nat({ max: 100_000 }),
    calendarDays: fc.integer({ min: 1, max: 1_000 }),
    spendWindowDays: fc.nat({ max: 100_000 }),
    finalizeUnverifiableHours: fc.nat({ max: 100_000 }),
  })
  .chain((w) =>
    fc
      .nat({ max: Math.min(w.beforeClaimMin, w.afterClaimMin, w.calendarDays * MINUTES_PER_DAY) - 1 })
      .map((toleranceMin) => ({ ...w, toleranceMin })),
  );

/**
 * True iff every type that lists features gives them a positive total weight, and every identity feature
 * has a weight above 0 (§5.3 v1.2).
 */
function listedWeightsPositive(features: Record<string, number>): boolean {
  return ActionType.options.every((type) => {
    const listed: readonly string[] = policyJson.featuresByType[type];
    const identity: readonly string[] = policyJson.identityFeatures[type];
    const positive = (feature: string): boolean => (features[feature] ?? 0) > 0;
    return (listed.length === 0 || listed.some(positive)) && identity.every(positive);
  });
}

describe('policy schema: the whole valid domain loads unchanged', () => {
  it('any version >= 1, valid windows, ordered grid thresholds and grid weights are accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        windows,
        fc.uniqueArray(fc.integer({ min: 0, max: BASIS_POINTS }), { minLength: 2, maxLength: 2 }),
        weights(Object.keys(policyJson.features)).filter(listedWeightsPositive),
        weights(Object.keys(policyJson.unasked.signals)),
        weight,
        (version, windowValues, [a = 0, b = 0], features, signals, threshold) => {
          const doc = {
            ...structuredClone(policyJson),
            version,
            windows: windowValues,
            thresholds: { verified: Math.max(a, b) / BASIS_POINTS, partial: Math.min(a, b) / BASIS_POINTS },
            features,
            unasked: { ...structuredClone(policyJson.unasked), signals, threshold },
          };
          const { bp, policyHash, ...loaded } = loadPolicy(doc);
          expect(loaded).toEqual(doc);
          expect(policyHash).toMatch(/^[0-9a-f]{64}$/);
          expect(bp.thresholds).toEqual({ verified: Math.max(a, b), partial: Math.min(a, b) });
          expect(bp.unasked.threshold).toBe(Math.round(threshold * BASIS_POINTS));
        },
      ),
      // qa_tester rule 4: property tests over src/core run at least 1,000 examples each.
      { numRuns: 1_000 },
    );
  });
});

/** Applies one change in place; a path that an earlier change removed or retyped is skipped. */
function applyChange(doc: unknown, path: Path, remove: boolean, value: unknown): void {
  let parent: unknown = doc;
  for (const segment of path.slice(0, -1)) {
    if (typeof parent !== 'object' || parent === null) return;
    parent = (parent as Container)[segment];
  }
  const key = path.at(-1);
  if (typeof parent !== 'object' || parent === null || key === undefined) return;
  if (remove) Reflect.deleteProperty(parent, key);
  else (parent as Container)[key] = value;
}

/** "path: problem", where the path is `(root)` or starts like `windows`, `[\"x\"]` or `_x`. */
const ISSUE_LINE = /^(?:\(root\)|[A-Za-z_$[]).*: \S/;

describe('policy loader: total on near-valid documents', () => {
  const vocabulary = STRINGS.map((entry) => entry.value);
  const change = fc.record({
    path: fc.constantFrom(...ENTRIES.map((entry) => entry.path)),
    remove: fc.boolean(),
    value: fc.oneof(fc.jsonValue(), fc.double(), fc.constantFrom(...vocabulary, [], {}, null, -0, 0.5)),
  });

  it('any 1-4 edits of the shipped policy load (frozen, hashed) or throw a PolicyError naming paths', () => {
    fc.assert(
      fc.property(fc.array(change, { minLength: 1, maxLength: 4 }), (changes) => {
        const doc: unknown = structuredClone(policyJson);
        for (const { path, remove, value } of changes) applyChange(doc, path, remove, value);
        let issues: readonly string[] = [];
        try {
          const policy = loadPolicy(doc);
          expect(Object.isFrozen(policy) && Object.isFrozen(policy.bp)).toBe(true);
          expect(policy.policyHash).toMatch(/^[0-9a-f]{64}$/);
        } catch (error) {
          if (!(error instanceof PolicyError)) throw error;
          issues = error.issues;
          expect(issues.length).toBeGreaterThan(0);
        }
        for (const line of issues) expect(line).toMatch(ISSUE_LINE);
      }),
      // qa_tester rule 4: property tests over src/core run at least 1,000 examples each.
      { numRuns: 1_000 },
    );
  });
});
