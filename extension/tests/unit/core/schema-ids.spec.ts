/**
 * OBS-1 (Hard Rules 2, 6): the names a component gives itself are tokens, and a health reason is a code. An
 * adapter, observer or extractor id and a version are one ASCII token (`COMPONENT_ID`), and every reason in a
 * HealthReport is a dotted snake_case code (`HEALTH_REASON`). Health runs inside the vendor tab beside the mail,
 * so a reason or an id that quoted the page (a line break, a space, a sentence) is refused at its own path,
 * never stored, never exported. The verifier's probes p8 and p9 are reproduced here.
 */
import { describe, expect, it } from 'vitest';

import { idFromHash } from '../../../src/core/hash';
import {
  Claim,
  ComponentId,
  HealthReport,
  ObserverCoverage,
  SCHEMA_LIMITS as L,
} from '../../../src/core/schema';
import { COMPONENT_ID, HEALTH_REASON } from '../../../src/core/schema-text';

const HASH = 'ab'.repeat(32);
const T = '2026-10-01T10:14:00-04:00';
const x = (n: number): string => 'x'.repeat(n);

/** Probe p8: a message body, padded to the old 120-character reason cap. */
const PROBE_BODY = 'Hi Priya,\nthe door code is 4417 and my SSN is 078-05-1120.\nThanks, P'.padEnd(120, '.');
/** Probe p9: an extractor id that quotes the page. */
const PROBE_ID = 'door code\n4417 SSN 078-05-1120';

const HEALTH = { adapterId: 'gmail.sent', version: '1.0.0', status: 'OK', reasons: [], checkedAt: T };
const CLAIM = {
  id: idFromHash(HASH),
  agent: 'muse',
  type: 'email.sent',
  claimedAt: T,
  claimedAtPrecision: 'minute',
  observedAt: T,
  sourceKind: 'chat',
  extractor: { id: 'muse.activity', version: '1.0.0', confidence: 1 },
  rawHash: HASH,
};
const ENTRY = {
  observerId: 'gmail.sent',
  source: 'gmail.sent',
  lastSyncAt: T,
  windowStart: T,
  windowEnd: T,
};

const IDS = [
  'gmail.sent',
  'muse.activity',
  'muse',
  'gcal',
  '1',
  '1.0.0',
  '2.3.1-beta',
  '1.0.0+build.7',
  x(L.ID),
];
const NOT_IDS = [
  '',
  'muse ',
  ' muse',
  'muse activity',
  'a\nb',
  'a\tb',
  'a b',
  '.hidden',
  '-x',
  'priya@company.com',
  'José',
  'a/b',
  PROBE_ID,
  x(L.ID + 1),
];
const REASONS = [
  'selector.missing',
  'not_sent_folder',
  'ambiguous_landmark',
  'dots_fixture_missing',
  'r',
  'a.b2.c',
];
const NOT_REASONS = [
  '',
  'Selector.missing',
  'selector missing',
  'selector.',
  '.selector',
  'selector..missing',
  'not-sent-folder',
  '1selector',
  'sélecteur',
  'a\nb',
  PROBE_BODY,
  x(L.ID + 1),
];

/** The path and message of each issue a parse raised; empty when it parsed. */
function issues(result: { error?: { issues: readonly { path: PropertyKey[]; message: string }[] } }) {
  return (result.error?.issues ?? []).map((issue) => [issue.path.map(String).join('.'), issue.message]);
}

describe('COMPONENT_ID: adapter, observer and extractor ids and versions', () => {
  it.each(IDS)('accepts %j at every id field', (id) => {
    expect(ComponentId.safeParse(id).success).toBe(true);
    expect(HealthReport.safeParse({ ...HEALTH, adapterId: id, version: id }).success).toBe(true);
    expect(Claim.safeParse({ ...CLAIM, extractor: { ...CLAIM.extractor, id, version: id } }).success).toBe(
      true,
    );
    expect(ObserverCoverage.safeParse({ ...ENTRY, observerId: id }).success).toBe(true);
  });

  it.each(NOT_IDS)('refuses %j at its own path', (id) => {
    const message: unknown = id.length > L.ID ? expect.any(String) : 'expected a short identifier';
    expect(issues(HealthReport.safeParse({ ...HEALTH, adapterId: id }))).toEqual([['adapterId', message]]);
    expect(issues(HealthReport.safeParse({ ...HEALTH, version: id }))).toEqual([['version', message]]);
    const claim = { ...CLAIM, extractor: { ...CLAIM.extractor, id, version: id } };
    expect(issues(Claim.safeParse(claim))).toEqual([
      ['extractor.id', message],
      ['extractor.version', message],
    ]);
    expect(issues(ObserverCoverage.safeParse({ ...ENTRY, observerId: id }))).toEqual([
      ['observerId', message],
    ]);
  });

  it('is one schema, shared by every id field', () => {
    expect(COMPONENT_ID.test('gmail.sent')).toBe(true);
    expect(HealthReport.shape.adapterId).toBe(ComponentId);
    expect(HealthReport.shape.version).toBe(ComponentId);
    expect(Claim.shape.extractor.shape.id).toBe(ComponentId);
    expect(Claim.shape.extractor.shape.version).toBe(ComponentId);
    expect(ObserverCoverage.shape.observerId).toBe(ComponentId);
  });
});

describe('HEALTH_REASON: a health reason is a code, never text', () => {
  it.each(REASONS)('accepts %j', (reason) => {
    expect(HEALTH_REASON.test(reason)).toBe(true);
    expect(HealthReport.safeParse({ ...HEALTH, status: 'DEGRADED', reasons: [reason] }).success).toBe(true);
  });

  it.each(NOT_REASONS)('refuses %j at its own path', (reason) => {
    const message: unknown = reason.length > L.ID ? expect.any(String) : 'expected a reason code';
    const result = HealthReport.safeParse({
      ...HEALTH,
      status: 'DEGRADED',
      reasons: ['selector.missing', reason],
    });
    expect(issues(result)).toContainEqual(['reasons.1', message]);
    expect(issues(result).every(([path]) => path === 'reasons.1')).toBe(true);
  });

  it('refuses probe p8: 32 message bodies as reasons (3,840 characters of mail)', () => {
    const reasons = Array.from({ length: L.REASONS }, () => PROBE_BODY);
    const result = HealthReport.safeParse({ ...HEALTH, status: 'DEGRADED', reasons });
    expect(result.success).toBe(false);
    expect(new Set(issues(result).map(([path]) => path)).size).toBe(L.REASONS);
  });

  it('a full report of codes at the caps still parses', () => {
    const reasons = Array.from({ length: L.REASONS }, (_, i) =>
      `selector.missing_${String(i)}`.padEnd(L.ID, '_'),
    );
    expect(HealthReport.safeParse({ ...HEALTH, status: 'DEGRADED', reasons }).success).toBe(true);
  });
});
