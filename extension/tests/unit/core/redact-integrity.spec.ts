/**
 * SEC-V1 (Hard Rule 2; docs/grading.md §10, §12): `observationIntegrityProblems(observation, policy)` says
 * whether an observation that arrives already built is one `project()` could have returned: only the content
 * fields its source's allowlist names, and a `contentHash` that is `contentHashOf` its content. And
 * `contentHashOf` is the one §10 definition: project(), this check and replay agree on it, and it matches a hash
 * computed here from hand-written canonical JSON with Node's crypto.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import defaultPolicyJson from '../../../../policy/default.json';
import { idFromHash } from '../../../src/core/hash';
import { DEFAULT_POLICY, loadPolicy } from '../../../src/core/policy';
import { contentHashOf, observationIntegrityProblems, project } from '../../../src/core/redact';
import { contentHashOf as replayContentHashOf } from '../../../src/core/replay-compare';
import { type ActionType, Observation, type ObservationSource } from '../../../src/core/schema';
import { makePolicies, syntheticWorld } from '../../tools/attest-world';

const nodeSha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const OCCURRED = '2026-10-06T14:02:00-04:00';
const OBSERVED = '2026-10-06T14:40:00-04:00';
const RAW = Object.freeze({
  counterparty: 'priya@company.com',
  merchant: 'Acme Books',
  amountCents: 1250,
  currency: 'USD',
  subjectHint: 'Q3 sync',
  occurredAt: OCCURRED,
});
const SOURCES: readonly (readonly [ObservationSource, ActionType])[] = [
  ['gmail.sent', 'email.sent'],
  ['gmail.receipt', 'purchase.made'],
  ['gcal.event', 'calendar.created'],
];

const projected = (source: ObservationSource, type: ActionType, rowKey?: string): Observation =>
  project(
    source,
    RAW,
    { type, observedAt: OBSERVED, ...(rowKey === undefined ? {} : { rowKey }) },
    DEFAULT_POLICY,
  );

/** A copy of `value` without `keys`. */
const without = (value: object, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

/** `fields` sealed with an honest hash and id, so only the allowlist can object. */
function sealed(fields: Record<string, unknown>): Observation {
  const contentHash = contentHashOf(fields);
  return Observation.parse({ ...fields, contentHash, id: idFromHash(contentHash) });
}

/** The security review's forged row: a gcal.event carrying receipt fields and a contentHash of its choosing. */
const FORGED_HASH = nodeSha('anything at all');
const FORGED = Observation.parse({
  id: idFromHash(FORGED_HASH),
  source: 'gcal.event',
  type: 'calendar.created',
  merchant: 'door code 4417 SSN 078-05-1120',
  amountCents: 7805,
  currency: 'USD',
  subjectHint: 'Q3 sync',
  occurredAt: OCCURRED,
  observedAt: OBSERVED,
  contentHash: FORGED_HASH,
});

describe('every observation project() returns has no integrity problem', () => {
  it.each(SOURCES)('%s, with and without a row key', (source, type) => {
    expect(observationIntegrityProblems(projected(source, type), DEFAULT_POLICY)).toStrictEqual([]);
    expect(observationIntegrityProblems(projected(source, type, 'row-17'), DEFAULT_POLICY)).toStrictEqual([]);
  });

  it('every row of the synthetic world (replay and property tests) is one project() could return', () => {
    const policies = [DEFAULT_POLICY, ...makePolicies().map(({ policy }) => policy)];
    for (const seed of [1, 2, 3]) {
      const { observations } = syntheticWorld({ seed, claims: 10, observations: 400, batches: 2 });
      expect(new Set(observations.map(({ source }) => source)).size).toBe(SOURCES.length);
      for (const observation of observations) {
        for (const policy of policies) {
          expect(observationIntegrityProblems(observation, policy), observation.id).toStrictEqual([]);
        }
      }
    }
  });

  it('the same row seen later (only observedAt differs) is still the same honest row', () => {
    const later = {
      ...projected('gmail.sent', 'email.sent'),
      observedAt: Observation.shape.observedAt.parse('2026-10-07T09:00:00Z'),
    };
    expect(observationIntegrityProblems(later, DEFAULT_POLICY)).toStrictEqual([]);
  });
});

describe('a row project() could not have returned is named, field by field', () => {
  it('the forged gcal.event row: three fields gcal.event never stores and a self-chosen contentHash', () => {
    expect(observationIntegrityProblems(FORGED, DEFAULT_POLICY)).toStrictEqual([
      ['merchant', 'not allowlisted for gcal.event'],
      ['amountCents', 'not allowlisted for gcal.event'],
      ['currency', 'not allowlisted for gcal.event'],
      ['contentHash', 'is not the §10 hash of the content'],
    ]);
  });

  it('a field outside the allowlist is refused even when the hash is honest', () => {
    const fields = without(FORGED, 'contentHash', 'id');
    expect(
      observationIntegrityProblems(sealed(fields), DEFAULT_POLICY).map(([field]) => field),
    ).toStrictEqual(['merchant', 'amountCents', 'currency']);
  });

  it('a self-chosen contentHash (with its matching id) is refused on an otherwise honest row', () => {
    const honest = projected('gmail.sent', 'email.sent');
    const chosen = nodeSha('a hash of my choosing');
    const forged = Observation.parse({ ...honest, contentHash: chosen, id: idFromHash(chosen) });
    expect(observationIntegrityProblems(forged, DEFAULT_POLICY)).toStrictEqual([
      ['contentHash', 'is not the §10 hash of the content'],
    ]);
  });
});

describe('content changed after projection no longer matches its hash; the policy decides the allowlist', () => {
  it.each([
    ['subjectHint', 'Q4 sync'],
    ['counterparty', 'arjun@company.com'],
    ['occurredAt', '2026-10-06T14:03:00-04:00'],
    ['type', 'calendar.deleted'],
    ['source', 'gmail.sent'],
  ])('content edited after projection (%s) no longer matches its hash', (field, value) => {
    const edited = Observation.parse({ ...projected('gcal.event', 'calendar.created'), [field]: value });
    expect(observationIntegrityProblems(edited, DEFAULT_POLICY)).toContainEqual([
      'contentHash',
      'is not the §10 hash of the content',
    ]);
  });

  it('a field dropped after projection no longer matches its hash', () => {
    const rest = without(projected('gmail.sent', 'email.sent'), 'subjectHint');
    expect(observationIntegrityProblems(Observation.parse(rest), DEFAULT_POLICY)).toHaveLength(1);
  });

  it('follows the policy it is given: a loaded policy that allowlists merchant on gcal.event accepts it', () => {
    const policy = loadPolicy({
      ...defaultPolicyJson,
      allowlistedFields: {
        ...defaultPolicyJson.allowlistedFields,
        'gcal.event': [...defaultPolicyJson.allowlistedFields['gcal.event'], 'merchant'],
      },
    });
    const row = sealed({
      source: 'gcal.event',
      type: 'calendar.created',
      merchant: 'Acme',
      occurredAt: OCCURRED,
      observedAt: OBSERVED,
    });
    expect(observationIntegrityProblems(row, policy)).toStrictEqual([]);
    expect(observationIntegrityProblems(row, DEFAULT_POLICY)).toStrictEqual([
      ['merchant', 'not allowlisted for gcal.event'],
    ]);
  });

  it('names fields only, never a value (Hard Rule 10)', () => {
    const text = JSON.stringify(observationIntegrityProblems(FORGED, DEFAULT_POLICY));
    for (const part of ['4417', '078-05-1120', '7805', 'Q3 sync']) expect(text).not.toContain(part);
  });
});

describe('contentHashOf is the one §10 content hash', () => {
  it('matches Node sha256 of hand-written canonical JSON (everything but id, observedAt, contentHash)', () => {
    const out = projected('gmail.receipt', 'purchase.made', 'row-17');
    const canonical = `{"amountCents":1250,"currency":"USD","merchant":"Acme Books","occurredAt":"${OCCURRED}","rowKeyHash":"${out.rowKeyHash ?? ''}","source":"gmail.receipt","subjectHint":"Q3 sync","type":"purchase.made"}`;
    expect(contentHashOf(out)).toBe(nodeSha(canonical));
    expect(out.contentHash).toBe(nodeSha(canonical));
  });

  it.each(SOURCES)('project(), the integrity check and replay agree on %s', (source, type) => {
    const out = projected(source, type, 'row-9');
    expect(contentHashOf(out)).toBe(out.contentHash);
    expect(replayContentHashOf(out)).toBe(out.contentHash);
    expect(replayContentHashOf(FORGED)).toBe(contentHashOf(FORGED));
  });
});
