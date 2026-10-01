/**
 * Sprint 0.8: the policy loader. The shipped policy loads, comes back deep-frozen, and every malformed
 * document is rejected with a PolicyError whose issues name the exact path and problem.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import {
  DEFAULT_POLICY,
  loadPolicy,
  ObservationFieldName,
  type Policy,
  PolicyError,
  RuleOutcome,
  TERMINAL_RULE_ID,
} from '../../../src/core/policy';
import { Grade, Observation } from '../../../src/ledger/types';

const REMOVE = Symbol('remove');
type PathSegment = string | number;

/** A copy of the shipped policy with one value replaced (or removed with REMOVE). */
function variant(path: readonly PathSegment[], value: unknown): unknown {
  const doc: unknown = structuredClone(policyJson);
  const last = path.at(-1);
  if (last === undefined) throw new Error('variant needs a non-empty path');
  let parent = doc as Record<PathSegment, unknown>;
  for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<PathSegment, unknown>;
  if (value === REMOVE) Reflect.deleteProperty(parent, last);
  else parent[last] = value;
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

/** Every object and array inside `value`, including `value` itself. */
function containers(value: unknown, found: object[] = []): object[] {
  if (typeof value === 'object' && value !== null) {
    found.push(value);
    Object.values(value).forEach((child: unknown) => containers(child, found));
  }
  return found;
}

function mutable<T>(list: readonly T[]): T[] {
  return list as T[];
}

const OUTCOMES = '"VERIFIED", "PARTIAL", "NOT_FOUND", "UNASKED", "OVER_SCOPE", "UNVERIFIABLE", "PENDING"';

describe('loadPolicy: the shipped policy/default.json', () => {
  it('loads and keeps every value and the rule order exactly', () => {
    const policy = loadPolicy(policyJson);
    expect(policy).toEqual(policyJson);
    expect(policy.rules.map((rule) => rule.id)).toEqual(policyJson.rules.map((rule) => rule.id));
  });

  it('DEFAULT_POLICY is the shipped document, loaded', () => {
    expect(DEFAULT_POLICY).toEqual(policyJson);
    expect(DEFAULT_POLICY.thresholds.partial).toBeLessThan(DEFAULT_POLICY.thresholds.verified);
  });

  it('returns a copy: the caller input is neither frozen nor shared', () => {
    const input = structuredClone(policyJson);
    const policy = loadPolicy(input);
    expect(Object.isFrozen(input)).toBe(false);
    input.thresholds.verified = 0;
    input.rules.length = 0;
    expect(policy.thresholds.verified).toBe(policyJson.thresholds.verified);
    expect(policy.rules).toHaveLength(policyJson.rules.length);
  });
});

describe('loadPolicy: the loaded policy is frozen at every depth', () => {
  it('Object.isFrozen holds for every nested object and array', () => {
    const found = containers(DEFAULT_POLICY);
    expect(found).toHaveLength(containers(policyJson).length);
    expect(found.filter((node) => !Object.isFrozen(node))).toEqual([]);
  });

  it('a freshly loaded policy is frozen too, not just DEFAULT_POLICY', () => {
    const found = containers(loadPolicy(structuredClone(policyJson)));
    expect(found.length).toBeGreaterThan(Object.keys(policyJson).length);
    expect(found.every((node) => Object.isFrozen(node))).toBe(true);
  });

  it('mutation attempts throw in strict mode and change nothing', () => {
    const policy: Policy = DEFAULT_POLICY;
    const verified = policy.thresholds.verified;
    expect(() => {
      (policy.thresholds as { verified: number }).verified = 1;
    }).toThrow(TypeError);
    expect(() => {
      (policy.rules[0]?.when as { coverage?: string }).coverage = 'all';
    }).toThrow(TypeError);
    expect(() => mutable(policy.rules).pop()).toThrow(TypeError);
    expect(() => mutable(policy.allowlistedFields['gmail.sent']).reverse()).toThrow(TypeError);
    expect(() => {
      (policy as { extra?: boolean }).extra = true;
    }).toThrow(TypeError);
    expect(Reflect.deleteProperty(policy.windows, 'graceMin')).toBe(false);
    expect(policy.thresholds.verified).toBe(verified);
    expect(policy).toEqual(policyJson);
  });
});

describe('loadPolicy: malformed policies produce specific, path-named errors', () => {
  const cases: readonly (readonly [string, readonly PathSegment[], unknown, string])[] = [
    ['missing window', ['windows', 'graceMin'], REMOVE, 'windows.graceMin: is required'],
    ['negative window', ['windows', 'afterClaimMin'], -5, 'windows.afterClaimMin: must be >= 0'],
    [
      'non-finite window',
      ['windows', 'calendarDays'],
      Infinity,
      'windows.calendarDays: must be a finite number',
    ],
    ['threshold above 1', ['thresholds', 'verified'], 1.2, 'thresholds.verified: must be <= 1'],
    [
      'threshold as a string',
      ['thresholds', 'partial'],
      '0.5',
      'thresholds.partial: expected number, got string',
    ],
    [
      'partial above verified',
      ['thresholds', 'partial'],
      0.9,
      'thresholds.partial: must be < thresholds.verified',
    ],
    [
      'partial equal to verified',
      ['thresholds', 'partial'],
      policyJson.thresholds.verified,
      'thresholds.partial: must be < thresholds.verified',
    ],
    ['unknown feature key', ['features', 'timeProximty'], 0.2, 'features.timeProximty: unknown key'],
    ['missing feature key', ['features', 'merchantMatch'], REMOVE, 'features.merchantMatch: is required'],
    ['negative feature weight', ['features', 'amountExact'], -0.1, 'features.amountExact: must be >= 0'],
    [
      'duplicate rule id',
      ['rules', 4, 'id'],
      'verified',
      'rules[4].id: duplicate rule id "verified" (first used at rules[3])',
    ],
    ['unknown condition key', ['rules', 0, 'when', 'covered'], 'none', 'rules[0].when.covered: unknown key'],
    ['empty when', ['rules', 6, 'when'], {}, 'rules[6].when: must name at least one condition'],
    ['bad then', ['rules', 3, 'then'], 'MAYBE', `rules[3].then: must be one of ${OUTCOMES}`],
    ['missing then', ['rules', 3, 'then'], REMOVE, 'rules[3].then: is required'],
    [
      'unknown threshold name',
      ['rules', 3, 'when', 'bestScoreGte'],
      'certain',
      'rules[3].when.bestScoreGte: must be one of "verified", "partial"',
    ],
    [
      'coverage other than none',
      ['rules', 0, 'when', 'coverage'],
      'partial',
      'rules[0].when.coverage: must be "none"',
    ],
    [
      'rule id not an identifier',
      ['rules', 0, 'id'],
      'No Coverage',
      'rules[0].id: must be a non-empty lowercase snake_case identifier',
    ],
    [
      'empty rule id',
      ['rules', 2, 'id'],
      '',
      'rules[2].id: must be a non-empty lowercase snake_case identifier',
    ],
    [
      'policy rule claiming the terminal rule id',
      ['rules', 6, 'id'],
      'default_unverifiable',
      'rules[6].id: is reserved for the terminal rule',
    ],
    ['no rules', ['rules'], [], 'rules: must not be empty'],
    [
      'unknown allowlist source',
      ['allowlistedFields', 'gmail.draft'],
      ['subjectHint'],
      'allowlistedFields["gmail.draft"]: unknown key',
    ],
    [
      'allowlisted field not an Observation field',
      ['allowlistedFields', 'gmail.sent', 1],
      'body',
      'allowlistedFields["gmail.sent"][1]: must be an Observation field name',
    ],
    [
      'duplicate allowlisted field',
      ['allowlistedFields', 'gmail.receipt', 2],
      'merchant',
      'allowlistedFields["gmail.receipt"][2]: duplicate field "merchant"',
    ],
    [
      'empty allowlist',
      ['allowlistedFields', 'gcal.event'],
      [],
      'allowlistedFields["gcal.event"]: must not be empty',
    ],
    [
      'missing allowlist source',
      ['allowlistedFields', 'gcal.event'],
      REMOVE,
      'allowlistedFields["gcal.event"]: is required',
    ],
    [
      'unknown unasked signal',
      ['unasked', 'signals', 'mouseMoved'],
      0.1,
      'unasked.signals.mouseMoved: unknown key',
    ],
    ['unasked threshold below 0', ['unasked', 'threshold'], -0.1, 'unasked.threshold: must be >= 0'],
    ['version 0', ['version'], 0, 'version: must be >= 1'],
    ['fractional version', ['version'], 1.5, 'version: must be an integer'],
    ['extra top-level key', ['extra'], true, 'extra: unknown key'],
  ];

  it.each(cases)('%s', (_name, path, value, expected) => {
    expect(issuesOf(variant(path, value))).toEqual([expected]);
  });

  it('covers at least 10 distinct malformed cases', () => {
    expect(new Set(cases.map(([, , , expected]) => expected)).size).toBeGreaterThanOrEqual(10);
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
    const doc = variant(['thresholds', 'verified'], 1.2) as { windows: Record<string, unknown> };
    doc.windows.graceMin = -1;
    expect(issuesOf(doc)).toEqual(['windows.graceMin: must be >= 0', 'thresholds.verified: must be <= 1']);
    expect(issuesOf({})).toHaveLength(Object.keys(policyJson).length);
  });

  it('PolicyError carries a typed code, a frozen issue list, and a name', () => {
    const error = (() => {
      try {
        loadPolicy(variant(['extra'], 1));
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(PolicyError);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof PolicyError)) return;
    expect(error.code).toBe('invalid_policy');
    expect(error.name).toBe('PolicyError');
    expect(Object.isFrozen(error.issues)).toBe(true);
    expect(error.message).toContain('extra: unknown key');
  });
});

describe('loadPolicy: properties', () => {
  /** qa_tester rule 4: property tests over src/core run at least 1,000 examples each. */
  const PROPERTY_RUNS = { numRuns: 1_000 };

  it('is total: any JSON value either loads or throws a PolicyError with issues', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (raw) => {
        try {
          loadPolicy(raw);
        } catch (error) {
          expect(error).toBeInstanceOf(PolicyError);
          expect(error instanceof PolicyError && error.issues.length > 0).toBe(true);
        }
      }),
      PROPERTY_RUNS,
    );
  });

  const UNIT_INTERVAL_PATHS: readonly (readonly PathSegment[])[] = [
    ...Object.keys(policyJson.thresholds).map((key) => ['thresholds', key]),
    ...Object.keys(policyJson.features).map((key) => ['features', key]),
    ...Object.keys(policyJson.unasked.signals).map((key) => ['unasked', 'signals', key]),
    ['unasked', 'threshold'],
  ];

  it('any weight or threshold above 1 is rejected naming its path', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...UNIT_INTERVAL_PATHS),
        fc.double({ min: 1, minExcluded: true, max: 1e9, noNaN: true }),
        (path, value) => {
          const where = path.join('.');
          expect(issuesOf(variant(path, value))).toContain(`${where}: must be <= 1`);
        },
      ),
      PROPERTY_RUNS,
    );
  });
});

describe('policy schema vocabularies stay in step with the ledger schemas', () => {
  it('ObservationFieldName lists exactly the Observation schema keys', () => {
    expect([...ObservationFieldName.options].sort()).toEqual(Object.keys(Observation.shape).sort());
  });

  it('RuleOutcome is every Grade plus PENDING', () => {
    expect([...RuleOutcome.options].sort()).toEqual([...Grade.options, 'PENDING'].sort());
  });

  it('TERMINAL_RULE_ID is the build_spec §7 terminal rule, and no shipped rule uses it', () => {
    expect(TERMINAL_RULE_ID).toBe('default_unverifiable');
    expect(DEFAULT_POLICY.rules.map((rule) => rule.id)).not.toContain(TERMINAL_RULE_ID);
  });
});
