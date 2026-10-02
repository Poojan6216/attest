/**
 * gradeBatch's candidate tables (batch-table.ts, batch-grade.ts; docs/grading.md §3, §4.1, §4.3): a batch derives
 * each claim's evidence (best candidate, candidatesHash, coverage) from its own tables, and must give exactly the
 * receipt `grade` gives for the same claim and its exclusive candidates. A table holding two rows with one id (a
 * corrupt ledger: ids derive from content hashes, §10) is left to `grade` itself, which names one row per id.
 */
import { describe, expect, it } from 'vitest';

import { gradeBatch } from '../../../src/core/batch';
import { createMemoryIndex } from '../../../src/core/candidates';
import { grade } from '../../../src/core/grade';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { Activity, Claim, Coverage, Grant, Observation, type Receipt } from '../../../src/core/schema';

const EVALUATED_AT = '2026-10-06T15:00:00-04:00';
const hash = (text: string) => sha256Hex(text);

function sentAt(occurredAt: string, contentHash: string) {
  return Observation.parse({
    id: idFromHash(contentHash),
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'priya@company.com',
    subjectHint: 'Q3 invoice',
    occurredAt,
    observedAt: occurredAt,
    contentHash,
  });
}

const CLAIM = Claim.parse({
  id: idFromHash(hash('claim c1')),
  agent: 'muse',
  type: 'email.sent',
  counterparty: 'priya@company.com',
  subjectHint: 'Q3 invoice',
  claimedAt: '2026-10-06T14:02:00-04:00',
  claimedAtPrecision: 'minute',
  observedAt: '2026-10-06T14:02:00-04:00',
  sourceKind: 'activity_view',
  extractor: { id: 'unit', version: '1', confidence: 1 },
  rawHash: hash('claim c1'),
});
const GRANT = Grant.parse({
  agent: 'muse',
  allowedTypes: ['email.sent'],
  counterpartyAllowlist: [],
  spendCeilingCents: null,
  declaredScopes: [],
  updatedAt: '2026-10-01T00:00:00-04:00',
});
const COVERAGE = Coverage.parse({
  evaluatedAt: EVALUATED_AT,
  observers: [
    {
      observerId: 'gmail',
      source: 'gmail.sent',
      lastSyncAt: EVALUATED_AT,
      windowStart: '2026-10-06T12:00:00-04:00',
      windowEnd: EVALUATED_AT,
      accountHash: hash('account'),
    },
  ],
});
const ACTIVITY = Activity.parse({ sessions: [], idle: [], entries: [], adapterSyncs: [], claims: [CLAIM] });

async function claimReceipt(observations: readonly Observation[]): Promise<Receipt | undefined> {
  const index = createMemoryIndex(observations, 15);
  const receipts = await gradeBatch([CLAIM], index, [GRANT], DEFAULT_POLICY, COVERAGE, ACTIVITY);
  return receipts.find((receipt) => receipt.claimId === CLAIM.id);
}

const direct = (candidates: readonly Observation[]) =>
  grade(CLAIM, candidates, GRANT, DEFAULT_POLICY, COVERAGE, { priorSpendCents: 0 });

describe('gradeBatch derives claim evidence from its tables exactly as grade() does', () => {
  it('several candidates, the best by exact score then id, hashed in id order', async () => {
    const rows = [
      sentAt('2026-10-06T14:02:30-04:00', hash('a')),
      sentAt('2026-10-06T14:20:00-04:00', hash('b')),
      sentAt('2026-10-06T14:01:00-04:00', hash('c')),
    ];
    const receipt = await claimReceipt(rows);
    expect(canonicalJson(receipt)).toBe(canonicalJson(direct(rows)));
    expect(receipt?.grade).toBe('VERIFIED');
  });

  it('a row seen twice (one id, one content hash) counts once, as grade() names it', async () => {
    const first = sentAt('2026-10-06T14:02:30-04:00', hash('a'));
    const later = { ...first, observedAt: '2026-10-06T14:40:00-04:00' };
    const receipt = await claimReceipt([first, Observation.parse(later)]);
    expect(canonicalJson(receipt)).toBe(canonicalJson(direct([first])));
  });

  it('a corrupt ledger (two different rows under one id) is graded by grade() itself, one row per id', async () => {
    const original = sentAt('2026-10-06T14:02:30-04:00', hash('a'));
    // The schema refuses such a row (id must derive from contentHash), so it is built as a broken ledger would hand it.
    const edited: Observation = {
      ...sentAt('2026-10-06T14:05:00-04:00', hash('a, edited')),
      id: original.id,
    };
    const rows = [original, edited, sentAt('2026-10-06T14:20:00-04:00', hash('b'))];
    const receipt = await claimReceipt(rows);
    expect(canonicalJson(receipt)).toBe(canonicalJson(direct(rows)));
    expect(receipt?.observationIds).toHaveLength(1);
  });
});
