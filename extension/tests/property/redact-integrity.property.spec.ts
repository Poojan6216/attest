/**
 * SEC-V1 (Hard Rule 2; docs/grading.md §10, §12): `observationIntegrityProblems(observation, policy)` against an
 * oracle written here from §10, over 1,000 random rows. Each starts as an honest `project()` of a random raw row
 * under the default policy or a random allowlist the loader accepts, then is left alone or tampered with the
 * way a buggy observer or a compromised content script could:
 *  - a content field its source never stores, sealed with an honest hash and id, or not resealed;
 *  - a contentHash of its own choosing (with the id that matches it);
 *  - a content field, `type` or `source` edited after projection, or a content field dropped (resealed or not).
 * For every row: the problems are exactly the oracle's, in schema order (each present content field outside
 * the allowlist, then a contentHash that is not SHA-256 of the sorted-key JSON of every field but id, observedAt
 * and contentHash); every tampered row is flagged and every honest one is not; messages come from a closed set
 * and name fields only, never a value (Hard Rule 10).
 */
import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../policy/default.json';
import { idFromHash } from '../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy, type Policy } from '../../src/core/policy';
import {
  CONTENT_FIELDS,
  type ContentField,
  observationIntegrityProblems,
  project,
} from '../../src/core/redact';
import { ActionType, Observation, ObservationSource, SCHEMA_LIMITS } from '../../src/core/schema';
import { isoTs, safeText } from './redact-arbitraries';

const nodeSha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const HASH_PROBLEM = 'is not the §10 hash of the content';
const NOT_HASHED: ReadonlySet<string> = new Set(['id', 'observedAt', 'contentHash']);

/** JSON of the present fields of `row` but `except`, keys sorted (all keys here are distinct ASCII names). */
function sortedJson(row: Readonly<Record<string, unknown>>, except: ReadonlySet<string> = new Set()): string {
  const entries = Object.entries(row)
    .filter(([key, value]) => value !== undefined && !except.has(key))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(Object.fromEntries(entries));
}

/** §10 from the spec: SHA-256 of the sorted-key JSON of every present field but id, observedAt and contentHash. */
const oracleHash = (row: Readonly<Record<string, unknown>>): string => nodeSha(sortedJson(row, NOT_HASHED));

/** The problems §10 and §12 predict for `row` under `allowlist`. */
function oracleProblems(row: Observation, allowlist: readonly string[]): [string, string][] {
  const fields = CONTENT_FIELDS.filter((field) => row[field] !== undefined && !allowlist.includes(field));
  const problems = fields.map((field): [string, string] => [field, `not allowlisted for ${row.source}`]);
  if (oracleHash(row) !== row.contentHash) problems.push(['contentHash', HASH_PROBLEM]);
  return problems;
}

/** `fields` with an honest contentHash and the id derived from it. */
function sealed(fields: Readonly<Record<string, unknown>>): Observation {
  const contentHash = oracleHash(fields);
  return Observation.parse({ ...fields, contentHash, id: idFromHash(contentHash) });
}

/** `fields` keeping the contentHash and id of `from`. */
const unsealed = (fields: Readonly<Record<string, unknown>>, from: Observation): Observation =>
  Observation.parse({ ...fields, contentHash: from.contentHash, id: from.id });

/** A valid value of each content field (safe text: letters, marks, an astral code point, lone surrogates). */
const VALUE: Readonly<Record<ContentField, fc.Arbitrary<unknown>>> = {
  counterparty: safeText(40),
  merchant: safeText(40),
  amountCents: fc.integer({ min: 0, max: SCHEMA_LIMITS.AMOUNT_CENTS }),
  currency: fc.constantFrom('USD', 'EUR', 'JPY'),
  subjectHint: safeText(40),
  occurredAt: isoTs,
};

const OPTIONAL = CONTENT_FIELDS.filter((field) => field !== 'occurredAt');
const allowlist = fc
  .subarray([...OPTIONAL])
  .map((fields) => [...fields, 'occurredAt', 'rowKeyHash', 'contentHash']);
const allowlists = fc.option(
  fc.record({ 'gmail.sent': allowlist, 'gmail.receipt': allowlist, 'gcal.event': allowlist }),
  { nil: undefined, freq: 3 },
);

const loaded = new Map<string, Policy>();
/** A loaded policy (never a hand-built one): the default, or the default document with these allowlists. */
function policyOf(allowlistedFields: Readonly<Record<string, readonly string[]>> | undefined): Policy {
  if (allowlistedFields === undefined) return DEFAULT_POLICY;
  const key = JSON.stringify(allowlistedFields);
  const policy = loaded.get(key) ?? loadPolicy({ ...defaultPolicyJson, allowlistedFields });
  loaded.set(key, policy);
  return policy;
}

const Tamper = fc.constantFrom(
  'none',
  'addSealed',
  'addUnsealed',
  'chosenHash',
  'edit',
  'retype',
  'resource',
  'drop',
  'dropSealed',
);
type Tamper = typeof Tamper extends fc.Arbitrary<infer T> ? T : never;

const example = fc.record({
  source: fc.constantFrom(...ObservationSource.options),
  type: fc.constantFrom(...ActionType.options),
  raw: fc.record(VALUE, { requiredKeys: ['occurredAt'] }),
  rowKey: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  observedAt: isoTs,
  allowlists,
  tamper: Tamper,
  /** Which field a tamper adds, edits or drops, as an index into the candidates. */
  pick: fc.nat(),
  value: fc.record(VALUE),
  type2: fc.constantFrom(...ActionType.options),
  source2: fc.constantFrom(...ObservationSource.options),
  chosen: fc.stringMatching(/^[0-9a-f]{64}$/),
});
type Example = typeof example extends fc.Arbitrary<infer T> ? T : never;

const counts: Record<Tamper | 'flagged' | 'unchanged', number> = {
  none: 0,
  addSealed: 0,
  addUnsealed: 0,
  chosenHash: 0,
  edit: 0,
  retype: 0,
  resource: 0,
  drop: 0,
  dropSealed: 0,
  flagged: 0,
  unchanged: 0,
};

/** A copy of `row` without `field`. */
const without = (row: Readonly<Record<string, unknown>>, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== field));

const at = <T>(items: readonly T[], index: number): T | undefined => items[index % Math.max(1, items.length)];

/** The tampered row, or undefined when this tamper does not apply to this row (nothing to add or drop). */
function tampered(input: Example, honest: Observation, allowed: readonly string[]): Observation | undefined {
  const { pick, value } = input;
  const fields: Record<string, unknown> = { ...honest };
  const absent = at(
    CONTENT_FIELDS.filter((field) => !allowed.includes(field)),
    pick,
  );
  const present = at(
    CONTENT_FIELDS.filter((field) => honest[field] !== undefined),
    pick,
  );
  const optional = at(
    OPTIONAL.filter((field) => honest[field] !== undefined),
    pick,
  );
  switch (input.tamper) {
    case 'none':
      return honest;
    case 'addSealed':
    case 'addUnsealed':
      if (absent === undefined) return undefined;
      fields[absent] = value[absent];
      return input.tamper === 'addSealed' ? sealed(fields) : unsealed(fields, honest);
    case 'chosenHash':
      return Observation.parse({ ...honest, contentHash: input.chosen, id: idFromHash(input.chosen) });
    case 'edit':
      if (present === undefined) return undefined;
      return unsealed({ ...fields, [present]: value[present] }, honest);
    case 'retype':
      return unsealed({ ...fields, type: input.type2 }, honest);
    case 'resource':
      return unsealed({ ...fields, source: input.source2 }, honest);
    case 'drop':
    case 'dropSealed':
      if (optional === undefined) return undefined;
      return input.tamper === 'dropSealed'
        ? sealed(without(fields, optional))
        : unsealed(without(fields, optional), honest);
  }
}

/** Whether `row` holds exactly the fields and values of `honest`. */
const sameRow = (row: Observation, honest: Observation): boolean => sortedJson(row) === sortedJson(honest);

function check(input: Example): void {
  const policy = policyOf(input.allowlists);
  const ctx = { type: input.type, observedAt: input.observedAt, rowKey: input.rowKey };
  const honest = project(input.source, input.raw, ctx, policy);
  expect(observationIntegrityProblems(honest, policy)).toStrictEqual([]);
  const row = tampered(input, honest, policy.allowlistedFields[honest.source]);
  if (row === undefined) return;
  counts[input.tamper] += 1;
  const problems = observationIntegrityProblems(row, policy);
  expect(problems).toStrictEqual(oracleProblems(row, policy.allowlistedFields[row.source]));
  const honestlySealed = input.tamper === 'dropSealed' || input.tamper === 'none';
  if (honestlySealed || sameRow(row, honest)) {
    counts.unchanged += 1;
    expect(problems).toStrictEqual([]);
    return;
  }
  counts.flagged += 1;
  expect(problems.length).toBeGreaterThan(0);
  for (const [field, message] of problems) {
    expect([...CONTENT_FIELDS, 'contentHash']).toContain(field);
    expect([HASH_PROBLEM, `not allowlisted for ${row.source}`]).toContain(message);
  }
}

describe('observationIntegrityProblems matches the §10/§12 oracle on honest and tampered rows', () => {
  it('1,000 random rows; every tamper flagged, every honest row clean', () => {
    fc.assert(fc.property(example, check), { numRuns: 1000 });
    const kinds = Object.entries(counts).filter(([kind]) => kind !== 'flagged' && kind !== 'unchanged');
    for (const [kind, seen] of kinds) expect(seen, kind).toBeGreaterThan(40);
    expect(counts.flagged).toBeGreaterThan(500);
    expect(counts.unchanged).toBeGreaterThan(100);
  });
});
