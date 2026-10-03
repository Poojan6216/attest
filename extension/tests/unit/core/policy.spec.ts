/**
 * Policy v2 (docs/grading.md §12, §5.3, §13): the shipped document is exactly the contract's §12 block,
 * loads, and comes back deep-frozen with exact integer basis points. policyHash: policy-hash.spec.ts.
 * Malformed documents: policy-errors*.spec.ts. Strictness walks: policy-shape.spec.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import {
  ConditionName,
  DEFAULT_POLICY,
  FeatureName,
  isBasisPointMultiple,
  loadPolicy,
  ObservationFieldName,
  type Policy,
  RuleOutcome,
  SignalName,
  TERMINAL_RULE_ID,
} from '../../../src/core/policy';
import {
  ActionType,
  AgentId,
  Grade,
  Observation,
  ObservationSource,
  RuleId,
  UnaskedSignal,
} from '../../../src/core/schema';
import { BASIS_POINTS } from '../../../src/core/units';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
const POLICY_FILE = path.join(REPO_ROOT, 'policy', 'default.json');
const GRADING_DOC = path.join(REPO_ROOT, 'docs', 'grading.md');
const PROPERTY_RUNS = { numRuns: 1_000 };

/** Removes `//` comments outside JSON strings; refuses block comments (the §12 block has none). */
function stripLineComments(jsonc: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < jsonc.length; i += 1) {
    const ch = jsonc.charAt(i);
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += jsonc.charAt(i + 1);
        i += 1;
      } else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && jsonc.charAt(i + 1) === '*') {
      throw new Error('block comments are not supported');
    } else if (ch === '/' && jsonc.charAt(i + 1) === '/') {
      while (i < jsonc.length && jsonc.charAt(i) !== '\n') i += 1;
      out += '\n';
    } else out += ch;
  }
  return out;
}

/** The body of the first ```jsonc fence inside `## 12.`, failing if the fence is not in that section. */
function section12Block(markdown: string): string {
  const start = markdown.indexOf('\n## 12. ');
  const next = markdown.indexOf('\n## ', start + 1);
  const open = markdown.indexOf('```jsonc\n', start);
  const bodyStart = open + '```jsonc\n'.length;
  const close = markdown.indexOf('\n```', bodyStart);
  if (start < 0 || open < 0 || close < 0 || close > next) throw new Error('no jsonc block in grading.md §12');
  return markdown.slice(bodyStart, close);
}

/** The loaded policy without the two derived fields: what must equal the document as written. */
function documentPart(policy: Policy): unknown {
  const { bp, policyHash, ...doc } = policy;
  expect(bp).toBeDefined();
  expect(policyHash).toBeDefined();
  return doc;
}

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

describe('policy/default.json is the docs/grading.md §12 contract', () => {
  it('the comment stripper keeps // inside strings and drops it outside', () => {
    const jsonc = '{ "a": "x//y", // note\n "b": "q\\"//r" // more\n }';
    expect(JSON.parse(stripLineComments(jsonc))).toEqual({ a: 'x//y', b: 'q"//r' });
    expect(() => stripLineComments('{ /* no */ }')).toThrow('block comments');
  });

  it('deep-equals the §12 jsonc block with its comments removed', () => {
    const block = section12Block(fs.readFileSync(GRADING_DOC, 'utf8'));
    expect(block).toContain('// last three chosen');
    const contract: unknown = JSON.parse(stripLineComments(block));
    expect(policyJson).toEqual(contract);
    expect(JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'))).toEqual(contract);
  });

  it('is Prettier-formatted JSON (2-space indent, trailing newline)', async () => {
    const text = fs.readFileSync(POLICY_FILE, 'utf8');
    const options = await prettier.resolveConfig(POLICY_FILE);
    expect(await prettier.check(text, { ...options, filepath: POLICY_FILE })).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.split('\n')[1]).toBe('  "version": 2,');
  });
});

describe('loadPolicy: the shipped document', () => {
  it('loads, keeping every field and the rule order exactly as written', () => {
    const policy = loadPolicy(policyJson);
    expect(documentPart(policy)).toEqual(policyJson);
    expect(policy.rules.map((rule) => rule.id)).toEqual(policyJson.rules.map((rule) => rule.id));
  });

  it('DEFAULT_POLICY is the shipped document, loaded', () => {
    expect(DEFAULT_POLICY).toEqual(loadPolicy(policyJson));
    expect(documentPart(DEFAULT_POLICY)).toEqual(policyJson);
  });

  it('returns a copy: the caller input is neither frozen nor shared', () => {
    const input = structuredClone(policyJson);
    const policy = loadPolicy(input);
    expect(Object.isFrozen(input)).toBe(false);
    input.thresholds.verified = 0;
    input.rules.length = 0;
    input.sourcesByType['email.sent'].length = 0;
    expect(policy.thresholds.verified).toBe(policyJson.thresholds.verified);
    expect(policy.rules).toHaveLength(policyJson.rules.length);
    expect(policy.sourcesByType['email.sent']).toEqual(['gmail.sent']);
  });
});

describe('loadPolicy: the loaded policy is frozen at every depth', () => {
  it('every nested object and array is frozen, the bp section included', () => {
    const found = containers(DEFAULT_POLICY);
    const bpContainers = containers(DEFAULT_POLICY.bp).length;
    expect(bpContainers).toBe(5);
    expect(found).toHaveLength(containers(policyJson).length + bpContainers);
    expect(found.filter((node) => !Object.isFrozen(node))).toEqual([]);
    expect(containers(loadPolicy(structuredClone(policyJson))).every((node) => Object.isFrozen(node))).toBe(
      true,
    );
  });

  it('mutation attempts throw in strict mode and change nothing', () => {
    const policy: Policy = DEFAULT_POLICY;
    expect(() => {
      (policy.thresholds as { verified: number }).verified = 1;
    }).toThrow(TypeError);
    expect(() => {
      (policy.bp.thresholds as { verified: number }).verified = 0;
    }).toThrow(TypeError);
    expect(() => {
      (policy as { policyHash: string }).policyHash = '0'.repeat(64);
    }).toThrow(TypeError);
    expect(() => mutable(policy.featuresByType['email.sent']).push('amountExact')).toThrow(TypeError);
    expect(() => mutable(policy.unasked.signatures.muse).push('via')).toThrow(TypeError);
    expect(() => mutable(policy.rules).pop()).toThrow(TypeError);
    expect(Reflect.deleteProperty(policy.windows, 'toleranceMin')).toBe(false);
    expect(policy.bp.thresholds.verified).toBe(8500);
    expect(documentPart(policy)).toEqual(policyJson);
  });
});

describe('loadPolicy: basis points (§5.3)', () => {
  it('converts the shipped weights and thresholds exactly', () => {
    expect(DEFAULT_POLICY.bp).toEqual({
      features: {
        timeProximity: 2500,
        counterpartyExact: 3500,
        counterpartyDomain: 1500,
        counterpartyName: 2500,
        subjectOverlap: 1500,
        amountExact: 2500,
        merchantMatch: 2000,
        modelScore: 0,
      },
      thresholds: { verified: 8500, partial: 5000 },
      unasked: {
        signals: {
          agentSessionActive: 4000,
          userIdle: 3000,
          agentSignature: 5000,
          activityLogAdjacent: 4000,
        },
        threshold: 6000,
      },
    });
  });

  it('every bp value is an integer that is exactly the decimal times 10,000', () => {
    const pairs: (readonly [number, number])[] = [
      ...FeatureName.options.map((k) => [policyJson.features[k], DEFAULT_POLICY.bp.features[k]] as const),
      ...SignalName.options.map(
        (k) => [policyJson.unasked.signals[k], DEFAULT_POLICY.bp.unasked.signals[k]] as const,
      ),
      [policyJson.thresholds.verified, DEFAULT_POLICY.bp.thresholds.verified],
      [policyJson.thresholds.partial, DEFAULT_POLICY.bp.thresholds.partial],
      [policyJson.unasked.threshold, DEFAULT_POLICY.bp.unasked.threshold],
    ];
    expect(pairs).toHaveLength(FeatureName.options.length + SignalName.options.length + 3);
    for (const [decimal, bp] of pairs) {
      expect(Number.isInteger(bp)).toBe(true);
      expect(bp / BASIS_POINTS).toBe(decimal);
    }
  });

  it('a weight written as -0 is 0 basis points (never -0); the document keeps it and hashes it as 0', () => {
    const doc = structuredClone(policyJson);
    doc.features.timeProximity = -0;
    doc.unasked.signals.userIdle = -0;
    const zero = structuredClone(policyJson);
    zero.features.timeProximity = 0;
    zero.unasked.signals.userIdle = 0;
    const policy = loadPolicy(doc);
    expect(Object.is(policy.bp.features.timeProximity, 0)).toBe(true);
    expect(Object.is(policy.bp.unasked.signals.userIdle, 0)).toBe(true);
    expect(Object.is(policy.features.timeProximity, -0)).toBe(true);
    expect(policy.policyHash).toBe(loadPolicy(zero).policyHash);
  });
});

describe('loadPolicy: the basis-point grid (§5.3)', () => {
  it('isBasisPointMultiple accepts 4-place decimals and rejects everything finer', () => {
    for (const ok of [0, 1, 0.0001, 0.5, 0.85, 0.9999, 0.1234]) expect(isBasisPointMultiple(ok)).toBe(true);
    for (const bad of [0.1 + 0.2, 0.00005, 0.99995, 1e-5, 0.12345, 0.0001 * 3, Math.PI / 4]) {
      expect(isBasisPointMultiple(bad)).toBe(false);
    }
  });

  it('property: k / 10,000 loads as exactly k basis points at any weight (identity features above 0)', () => {
    const paths = [
      ...FeatureName.options.map((key) => ['features', key] as const),
      ...SignalName.options.map((key) => ['unasked', 'signals', key] as const),
    ];
    const identity = new Set<string>(Object.values(policyJson.identityFeatures).flat());
    const grid = fc.integer({ min: 0, max: BASIS_POINTS });
    const named = fc
      .tuple(fc.constantFrom(...paths), grid)
      .filter(([where, k]) => k > 0 || where[0] !== 'features' || !identity.has(where[1]));
    fc.assert(
      fc.property(named, ([where, k]) => {
        const doc = structuredClone(policyJson);
        if (where[0] === 'features') doc.features[where[1]] = k / BASIS_POINTS;
        else doc.unasked.signals[where[2]] = k / BASIS_POINTS;
        const policy = loadPolicy(doc);
        const bp =
          where[0] === 'features' ? policy.bp.features[where[1]] : policy.bp.unasked.signals[where[2]];
        expect(bp).toBe(k);
      }),
      PROPERTY_RUNS,
    );
  });

  it('property: ordered thresholds (partial above 0) and the unasked threshold (above 0) convert exactly', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: BASIS_POINTS }), { minLength: 2, maxLength: 2 }),
        fc.integer({ min: 1, max: BASIS_POINTS }),
        ([a = 0, b = 0], unasked) => {
          const doc = structuredClone(policyJson);
          doc.thresholds = {
            verified: Math.max(a, b) / BASIS_POINTS,
            partial: Math.min(a, b) / BASIS_POINTS,
          };
          doc.unasked.threshold = unasked / BASIS_POINTS;
          const { bp } = loadPolicy(doc);
          expect(bp.thresholds).toEqual({ verified: Math.max(a, b), partial: Math.min(a, b) });
          expect(bp.unasked.threshold).toBe(unasked);
        },
      ),
      PROPERTY_RUNS,
    );
  });
});

describe('policy vocabularies come from the core schema', () => {
  it('ObservationFieldName is the Observation keys minus the four redact.ts computes and sightedAt (§12 v1.3)', () => {
    const computed = ['id', 'source', 'type', 'observedAt', 'sightedAt'];
    const keys = Object.keys(Observation.shape).filter((key) => !computed.includes(key));
    expect([...ObservationFieldName.options].sort()).toEqual(keys.sort());
    expect(ObservationFieldName.options).toContain('rowKeyHash');
    expect(ObservationFieldName.options).not.toContain('sightedAt');
  });

  it('per-type and per-agent maps have exactly one key per ActionType / AgentId / source', () => {
    for (const map of [policyJson.sourcesByType, policyJson.featuresByType, policyJson.identityFeatures]) {
      expect(Object.keys(map).sort()).toEqual([...ActionType.options].sort());
    }
    expect(Object.keys(policyJson.unasked.signatures).sort()).toEqual([...AgentId.options].sort());
    expect(Object.keys(policyJson.allowlistedFields).sort()).toEqual([...ObservationSource.options].sort());
  });

  it('feature and signal names are the keys of features and unasked.signals', () => {
    expect([...FeatureName.options].sort()).toEqual(Object.keys(policyJson.features).sort());
    expect([...SignalName.options].sort()).toEqual([...UnaskedSignal.options].sort());
    expect([...SignalName.options].sort()).toEqual(Object.keys(policyJson.unasked.signals).sort());
  });

  it('RuleOutcome is every Grade plus PENDING; every rule id is a valid receipt ruleId', () => {
    expect([...RuleOutcome.options].sort()).toEqual([...Grade.options, 'PENDING'].sort());
    for (const rule of DEFAULT_POLICY.rules) expect(RuleId.safeParse(rule.id).success).toBe(true);
    expect(RuleId.safeParse(TERMINAL_RULE_ID).success).toBe(true);
  });

  it('TERMINAL_RULE_ID is default_unverifiable, and no shipped rule uses it', () => {
    expect(TERMINAL_RULE_ID).toBe('default_unverifiable');
    expect(DEFAULT_POLICY.rules.map((rule) => rule.id)).not.toContain(TERMINAL_RULE_ID);
  });

  it('every condition the schema knows is used by a shipped rule', () => {
    const used = new Set(DEFAULT_POLICY.rules.flatMap((rule) => Object.keys(rule.when)));
    expect([...used].sort()).toEqual([...ConditionName.options].sort());
  });
});
