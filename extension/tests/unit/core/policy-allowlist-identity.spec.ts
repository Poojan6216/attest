/**
 * Policy loader rules added by docs/grading.md v1.3 (§5.3, §12), five or more valid documents (each loads) and
 * five or more invalid ones (each rejected with the exact "path: problem" lines):
 *  - `allowlistedFields[source]` may name only the content fields (`counterparty`, `merchant`, `amountCents`,
 *    `currency`, `subjectHint`, `occurredAt`) and the derived markers `rowKeyHash` and `contentHash`; never
 *    `id`, `source`, `type` or `observedAt` (redact.ts computes them); `occurredAt` is required in every entry.
 *  - a type with sources must have a non-empty `identityFeatures` list, so every claim that can be assigned has a
 *    weighted identity feature (and `features()` never meets Σw = 0 on an assignable claim).
 */
import { describe, expect, it } from 'vitest';

import policyJson from '../../../../policy/default.json';
import {
  applicableFeatures,
  features,
  type FeatureClaim,
  isAssignable,
  isUnderspecified,
} from '../../../src/core/features';
import {
  ALLOWLISTABLE_FIELDS,
  loadPolicy,
  ObservationFieldName,
  PolicyError,
} from '../../../src/core/policy';
import { RatioError } from '../../../src/core/ratio';
import { CONTENT_FIELDS } from '../../../src/core/redact';
import { ActionType } from '../../../src/core/schema';

type Patch = Readonly<Record<string, unknown>>;

/** The shipped policy with top-level keys replaced. */
const patched = (patch: Patch): unknown => ({ ...structuredClone(policyJson), ...patch });
const allowlist = (source: string, fields: readonly string[]): unknown =>
  patched({ allowlistedFields: { ...policyJson.allowlistedFields, [source]: fields } });
const identity = (type: string, fields: readonly string[]): unknown =>
  patched({ identityFeatures: { ...policyJson.identityFeatures, [type]: fields } });

function issuesOf(raw: unknown): readonly string[] {
  try {
    loadPolicy(raw);
  } catch (error) {
    if (error instanceof PolicyError) return error.issues;
    throw error;
  }
  return [];
}

const FIELD = 'must be a content field, rowKeyHash or contentHash';
const OCCURRED = 'must list "occurredAt"';
const IDENTITY = 'must not be empty for a type with sources';
const TYPES_WITH_SOURCES = ActionType.options.filter((type) => policyJson.sourcesByType[type].length > 0);

const ALLOWLIST_VALID: readonly (readonly [string, unknown])[] = [
  ['the shipped policy', policyJson],
  ['occurredAt alone', allowlist('gmail.sent', ['occurredAt'])],
  ['every allowlistable field', allowlist('gmail.receipt', [...ALLOWLISTABLE_FIELDS])],
  ['occurredAt last', allowlist('gcal.event', ['subjectHint', 'counterparty', 'occurredAt'])],
  [
    'only the derived markers besides occurredAt',
    allowlist('gmail.sent', ['contentHash', 'occurredAt', 'rowKeyHash']),
  ],
];

const ALLOWLIST_INVALID: readonly (readonly [string, unknown, readonly string[]])[] = [
  ['id', allowlist('gmail.sent', ['occurredAt', 'id']), [`allowlistedFields["gmail.sent"][1]: ${FIELD}`]],
  [
    'source',
    allowlist('gmail.sent', ['source', 'occurredAt']),
    [`allowlistedFields["gmail.sent"][0]: ${FIELD}`],
  ],
  ['type', allowlist('gcal.event', ['occurredAt', 'type']), [`allowlistedFields["gcal.event"][1]: ${FIELD}`]],
  [
    'observedAt',
    allowlist('gmail.receipt', ['occurredAt', 'observedAt']),
    [`allowlistedFields["gmail.receipt"][1]: ${FIELD}`],
  ],
  [
    'a body',
    allowlist('gmail.sent', ['occurredAt', 'body']),
    [`allowlistedFields["gmail.sent"][1]: ${FIELD}`],
  ],
  [
    'no occurredAt',
    allowlist('gmail.receipt', ['merchant', 'amountCents']),
    [`allowlistedFields["gmail.receipt"]: ${OCCURRED}`],
  ],
  ['an empty list', allowlist('gcal.event', []), [`allowlistedFields["gcal.event"]: ${OCCURRED}`]],
  [
    // The list-level check runs once every item is valid (like the duplicate check): one issue per load.
    'observedAt in place of occurredAt',
    allowlist('gmail.sent', ['counterparty', 'observedAt']),
    [`allowlistedFields["gmail.sent"][1]: ${FIELD}`],
  ],
];

const IDENTITY_VALID: readonly (readonly [string, unknown])[] = [
  ['the shipped policy', policyJson],
  ['a no-source type with an empty list', identity('message.sent', [])],
  [
    'a no-source type with an identity list',
    patched({
      featuresByType: { ...policyJson.featuresByType, other: ['timeProximity'] },
      identityFeatures: { ...policyJson.identityFeatures, other: ['timeProximity'] },
    }),
  ],
  ['a single identity feature', identity('purchase.made', ['merchantMatch'])],
  ['time as the identity feature', identity('email.sent', ['timeProximity'])],
];

const IDENTITY_INVALID: readonly (readonly [string, unknown, readonly string[]])[] = [
  ['email.sent', identity('email.sent', []), [`identityFeatures["email.sent"]: ${IDENTITY}`]],
  [
    'calendar.created',
    identity('calendar.created', []),
    [`identityFeatures["calendar.created"]: ${IDENTITY}`],
  ],
  ['purchase.made', identity('purchase.made', []), [`identityFeatures["purchase.made"]: ${IDENTITY}`]],
  ['listing.posted', identity('listing.posted', []), [`identityFeatures["listing.posted"]: ${IDENTITY}`]],
  [
    'a no-source type given a source',
    patched({ sourcesByType: { ...policyJson.sourcesByType, other: ['gmail.sent'] } }),
    [`identityFeatures.other: ${IDENTITY}`],
  ],
  [
    'every type with sources',
    patched({
      identityFeatures: Object.fromEntries(ActionType.options.map((type) => [type, []])),
    }),
    TYPES_WITH_SOURCES.map((type) => `identityFeatures["${type}"]: ${IDENTITY}`),
  ],
];

describe('allowlistedFields vocabulary (§12 v1.3)', () => {
  it('is exactly the six content fields plus rowKeyHash and contentHash', () => {
    expect(ObservationFieldName.options).toEqual([...ALLOWLISTABLE_FIELDS]);
    expect([...ALLOWLISTABLE_FIELDS].sort()).toEqual(
      [
        'amountCents',
        'contentHash',
        'counterparty',
        'currency',
        'merchant',
        'occurredAt',
        'rowKeyHash',
        'subjectHint',
      ].sort(),
    );
  });

  it("is redact.ts's content fields plus the two derived markers, so the two modules agree", () => {
    expect([...ObservationFieldName.options].sort()).toEqual(
      [...CONTENT_FIELDS, 'rowKeyHash', 'contentHash'].sort(),
    );
  });

  it.each(ALLOWLIST_VALID)('%s loads', (_label, raw) => {
    expect(issuesOf(raw)).toEqual([]);
  });

  it.each(ALLOWLIST_INVALID)('naming %s is rejected at its path', (_label, raw, expected) => {
    expect(issuesOf(raw)).toEqual(expected);
  });

  it('has at least five valid and five invalid cases', () => {
    expect(ALLOWLIST_VALID.length).toBeGreaterThanOrEqual(5);
    expect(ALLOWLIST_INVALID.length).toBeGreaterThanOrEqual(5);
  });
});

describe('identityFeatures: required for a type with sources (§5.3 v1.3)', () => {
  it.each(IDENTITY_VALID)('%s loads', (_label, raw) => {
    expect(issuesOf(raw)).toEqual([]);
  });

  it.each(IDENTITY_INVALID)('an empty list for %s is rejected at its path', (_label, raw, expected) => {
    expect(issuesOf(raw)).toEqual(expected);
  });

  it('has at least five valid and five invalid cases', () => {
    expect(IDENTITY_VALID.length).toBeGreaterThanOrEqual(5);
    expect(IDENTITY_INVALID.length).toBeGreaterThanOrEqual(5);
  });

  it('closes the Σw = 0 hole: a time-only email claim with time weighted 0 can no longer load', () => {
    // v1.2 let this policy load; a bare claim was then "not underspecified" yet had nothing weighted to score.
    const document = patched({
      features: { ...policyJson.features, timeProximity: 0 },
      identityFeatures: { ...policyJson.identityFeatures, 'email.sent': [] },
    });
    expect(issuesOf(document)).toEqual([`identityFeatures["email.sent"]: ${IDENTITY}`]);
  });

  it('under the loadable version of that policy the bare claim is underspecified, so never scored', () => {
    const policy = loadPolicy(patched({ features: { ...policyJson.features, timeProximity: 0 } }));
    const bare: FeatureClaim = {
      type: 'email.sent',
      claimedAt: '2026-10-06T14:02:00-04:00',
      claimedAtPrecision: 'minute',
    };
    expect(applicableFeatures(bare, policy)).toEqual(['timeProximity']);
    expect(isUnderspecified(bare, policy)).toBe(true);
    expect(isAssignable(bare, policy)).toBe(false);
    expect(() => features(bare, { occurredAt: bare.claimedAt }, policy)).toThrow(RatioError);
  });
});
