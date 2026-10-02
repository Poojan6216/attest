/**
 * Policy v2 (docs/grading.md §3, §10): `policyHash` is the SHA-256 of the canonical JSON of the policy
 * document. It is stored on every receipt, so it must depend only on the document's content: the same for
 * any key order, different for any change of value or list order, and never influenced by the derived
 * `bp` section.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import { canonicalJson } from '../../../src/core/hash';
import {
  DEFAULT_POLICY,
  FeatureName,
  loadPolicy,
  ObservationFieldName,
  type Policy,
  PolicyError,
  RuleOutcome,
} from '../../../src/core/policy';
import { ActionType, ObservationSource } from '../../../src/core/schema';
import { BASIS_POINTS } from '../../../src/core/units';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The same value with every object's keys in reverse order (arrays keep their order). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([k, v]) => [k, reverseKeys(v)]),
  );
}

type Leaf = string | number | boolean;
type Segment = string | number;
const ENUM_WORDS = [
  ...ActionType.options,
  ...ObservationSource.options,
  ...FeatureName.options,
  ...ObservationFieldName.options,
  ...RuleOutcome.options,
  'none',
  'partial',
  'full',
  'verified',
];

function alternatives(value: Leaf): Leaf[] {
  if (typeof value === 'boolean') return [!value];
  if (typeof value === 'string') return [`${value}x`, ...ENUM_WORDS.filter((word) => word !== value)];
  if (Number.isInteger(value)) return [value + 1, value - 1];
  const bp = Math.round(value * BASIS_POINTS);
  return [(bp + 1) / BASIS_POINTS, (bp - 1) / BASIS_POINTS];
}

function withLeaf(trail: readonly Segment[], value: Leaf): unknown {
  const doc: unknown = structuredClone(policyJson);
  let parent = doc as Record<Segment, unknown>;
  for (const segment of trail.slice(0, -1)) parent = parent[segment] as Record<Segment, unknown>;
  parent[trail.at(-1) ?? ''] = value;
  return doc;
}

function tryLoad(doc: unknown): Policy | undefined {
  try {
    return loadPolicy(doc);
  } catch (error) {
    if (error instanceof PolicyError) return undefined;
    throw error;
  }
}

/** Every leaf of the document with its path, depth first. */
function leaves(node: unknown, trail: Segment[] = [], found: [Segment[], Leaf][] = []): [Segment[], Leaf][] {
  if (typeof node === 'object' && node !== null) {
    if (Array.isArray(node)) node.forEach((child: unknown, i) => leaves(child, [...trail, i], found));
    else Object.entries(node).forEach(([key, child]) => leaves(child, [...trail, key], found));
  } else found.push([trail, node as Leaf]);
  return found;
}

/** For every leaf, the hash of the first single-leaf change that still loads (some leaves have none). */
function changedLeaves(): { section: string; where: string; hash: string }[] {
  return leaves(policyJson).flatMap(([trail, value]) => {
    for (const candidate of alternatives(value)) {
      const policy = tryLoad(withLeaf(trail, candidate));
      if (policy) return [{ section: String(trail[0]), where: trail.join('/'), hash: policy.policyHash }];
    }
    return [];
  });
}

describe('loadPolicy: policyHash', () => {
  it('is the SHA-256 of the canonical JSON of the document (not of bp)', () => {
    expect(DEFAULT_POLICY.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(DEFAULT_POLICY.policyHash).toBe(sha256(canonicalJson(policyJson)));
    expect(DEFAULT_POLICY.policyHash).not.toBe(
      sha256(canonicalJson({ ...policyJson, bp: DEFAULT_POLICY.bp })),
    );
  });

  it('is stable across key order at every level', () => {
    const reversed = reverseKeys(policyJson);
    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(policyJson));
    expect(loadPolicy(reversed).policyHash).toBe(DEFAULT_POLICY.policyHash);
    expect(loadPolicy(structuredClone(policyJson)).policyHash).toBe(DEFAULT_POLICY.policyHash);
  });

  it('changes when any single value changes (every leaf that can change validly)', () => {
    const changed = changedLeaves();
    for (const { where, hash } of changed) expect(hash, where).not.toBe(DEFAULT_POLICY.policyHash);
    expect(new Set(changed.map(({ hash }) => hash)).size).toBe(changed.length);
    expect(changed.length).toBeGreaterThan(leaves(policyJson).length / 2);
    const sections = new Set(changed.map(({ section }) => section));
    const withLeaves = Object.keys(policyJson).filter((key) => key !== 'receiptMerchants');
    expect([...sections].sort()).toEqual(withLeaves.sort());
  });

  it('changes when a list gains an entry, e.g. a receipt merchant or a signature', () => {
    const merchants = { ...structuredClone(policyJson), receiptMerchants: ['acme'] };
    const unasked = structuredClone(policyJson.unasked);
    const signatures = {
      ...structuredClone(policyJson),
      unasked: { ...unasked, signatures: { ...unasked.signatures, muse: ['via muse'] } },
    };
    for (const doc of [merchants, signatures]) {
      expect(loadPolicy(doc).policyHash).not.toBe(DEFAULT_POLICY.policyHash);
    }
  });

  it('changes when list order changes (lists are hashed as written)', () => {
    const doc = structuredClone(policyJson);
    doc.normalize.stopWords.reverse();
    expect(loadPolicy(doc).policyHash).not.toBe(DEFAULT_POLICY.policyHash);
  });
});
