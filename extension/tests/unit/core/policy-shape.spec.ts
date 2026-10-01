/**
 * Sprint 0.8: the policy schema is strict at EVERY level, requires every key the shipped document has,
 * types every value, and accepts the whole valid domain. These tests walk policy/default.json itself,
 * so loosening any level (z.object for z.strictObject), making any key optional, or widening any type
 * fails here, not only at the paths the hand-written table in policy.spec.ts happens to name.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import { loadPolicy, PolicyError, ThresholdName } from '../../../src/core/policy';
import { ObservationSource } from '../../../src/ledger/types';

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
const CONDITIONS = ENTRIES.filter((e) => isCondition(e.path));

const label = (path: Path): string => (path.length === 0 ? '(root)' : pathText(path));

describe('policy schema: strict at every level', () => {
  it('the walk reaches every level of the document', () => {
    const seen = OBJECT_PATHS.map(label);
    for (const level of ['(root)', 'windows', 'thresholds', 'features', 'rules[0]', 'rules[6].when']) {
      expect(seen).toContain(level);
    }
    expect(seen).toEqual(expect.arrayContaining(['unasked', 'unasked.signals', 'allowlistedFields']));
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

  it('every condition the schema knows appears in the shipped rules (so the next test covers each)', () => {
    const keys = new Set(CONDITIONS.map((entry) => entry.path.at(-1)));
    expect([...keys].sort()).toEqual(
      [
        'amountAboveCeiling',
        'bestScoreGte',
        'bestScoreLt',
        'coverage',
        'graceElapsed',
        'typeNotInGrant',
      ].sort(),
    );
  });

  it.each(CONDITIONS.map((entry) => [pathText(entry.path), entry.path, entry.value] as const))(
    'condition %s rejects a value of the wrong kind',
    (where, path, value) => {
      if (typeof value === 'boolean') {
        expect(issuesOf(setTo(path, 'true'))).toEqual([`${where}: expected boolean, got string`]);
      } else if (path.at(-1) === 'coverage') {
        expect(issuesOf(setTo(path, 'all'))).toEqual([`${where}: must be "none"`]);
      } else {
        expect(issuesOf(setTo(path, 'certain'))).toEqual([`${where}: must be one of "verified", "partial"`]);
      }
    },
  );
});

describe('policy schema: vocabularies match the document and the ledger', () => {
  it('threshold names are exactly the thresholds the policy defines', () => {
    expect([...ThresholdName.options].sort()).toEqual(Object.keys(policyJson.thresholds).sort());
  });

  it('allowlist sources are exactly the Observation sources (no source without a redaction list)', () => {
    expect(Object.keys(policyJson.allowlistedFields).sort()).toEqual([...ObservationSource.options].sort());
  });
});

describe('policy schema: the whole valid domain loads unchanged', () => {
  const unit = fc.double({ min: 0, max: 1, noNaN: true });
  const nonNegative = fc.double({ min: 0, max: 1e6, noNaN: true });
  const weights = (keys: readonly string[]) => fc.record(Object.fromEntries(keys.map((key) => [key, unit])));

  it('any version >= 1, non-negative windows, ordered thresholds, and unit weights are accepted', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.record(Object.fromEntries(Object.keys(policyJson.windows).map((key) => [key, nonNegative]))),
        fc.tuple(unit, unit).filter(([a, b]) => a !== b),
        weights(Object.keys(policyJson.features)),
        weights(Object.keys(policyJson.unasked.signals)),
        unit,
        (version, windows, [a, b], features, signals, threshold) => {
          const doc = {
            ...structuredClone(policyJson),
            version,
            windows,
            thresholds: { verified: Math.max(a, b), partial: Math.min(a, b) },
            features,
            unasked: { signals, threshold },
          };
          expect(loadPolicy(doc)).toEqual(doc);
        },
      ),
    );
  });
});
