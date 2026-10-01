import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { claimsByAgentAndDate, getClaim, upsertClaim } from '../../../src/ledger/repo';
import { expectLedgerError, makeClaim, omit, sha, ulid, uniqueDbName } from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  db = await openLedger(uniqueDbName('claims'));
});

afterEach(() => {
  db.close();
});

describe('upsertClaim', () => {
  it('inserts a new claim and round-trips the exact domain object (no index fields)', async () => {
    const claim = makeClaim({ amountCents: 4999, currency: 'USD', type: 'purchase.made' });
    expect(await upsertClaim(db, claim)).toEqual({ id: claim.id, inserted: true });
    const stored = await getClaim(db, claim.id);
    expect(stored).toEqual(claim);
    expect(stored).not.toHaveProperty('date');
  });

  it('is a no-op for a duplicate rawHash: returns the first id and never overwrites', async () => {
    const first = makeClaim();
    await upsertClaim(db, first);
    const again = makeClaim({ id: ulid(102), observedAt: '2026-10-01T11:00:00-04:00' });
    expect(await upsertClaim(db, again)).toEqual({ id: first.id, inserted: false });
    expect(await db.claims.count()).toBe(1);
    expect(await getClaim(db, first.id)).toEqual(first);
  });

  it('rejects invalid input (unknown agent, extra key, bad confidence) and writes nothing', async () => {
    await expectLedgerError(upsertClaim(db, makeClaim({ agent: 'gemini' as never })), 'invalid_input');
    const withTranscript = { ...makeClaim(), transcript: 'chat text' };
    await expectLedgerError(upsertClaim(db, withTranscript), 'invalid_input');
    const extractor = { id: 'muse.activity', version: '1.0.0', confidence: 1.5 };
    await expectLedgerError(upsertClaim(db, makeClaim({ extractor })), 'invalid_input');
    expect(await db.claims.count()).toBe(0);
  });

  it('rejects an existing id with a different rawHash as id_conflict', async () => {
    await upsertClaim(db, makeClaim());
    await expectLedgerError(upsertClaim(db, makeClaim({ rawHash: sha(999) })), 'id_conflict');
    expect(await getClaim(db, makeClaim().id)).toEqual(makeClaim());
  });
});

describe('getClaim', () => {
  it('returns the stored claim by id', async () => {
    const noRequest = omit(makeClaim(), 'requestId');
    await upsertClaim(db, noRequest);
    expect(await getClaim(db, noRequest.id)).toEqual(noRequest);
  });

  it('returns undefined for an unknown id', async () => {
    await upsertClaim(db, makeClaim());
    expect(await getClaim(db, ulid(404))).toBeUndefined();
  });
});

describe('claimsByAgentAndDate', () => {
  it("returns one agent's claims on the local date of claimedAt", async () => {
    const lateNight = makeClaim({ id: ulid(1), rawHash: sha(1), claimedAt: '2026-10-01T23:50:00-04:00' });
    const morning = makeClaim({ id: ulid(2), rawHash: sha(2), claimedAt: '2026-10-01T08:00:00-04:00' });
    const nextDay = makeClaim({ id: ulid(3), rawHash: sha(3), claimedAt: '2026-10-02T08:00:00-04:00' });
    const otherAgent = makeClaim({ id: ulid(4), rawHash: sha(4), agent: 'claude' });
    for (const claim of [lateNight, morning, nextDay, otherAgent]) await upsertClaim(db, claim);
    expect(await claimsByAgentAndDate(db, 'muse', '2026-10-01')).toEqual([lateNight, morning]);
    expect(await claimsByAgentAndDate(db, 'claude', '2026-10-01')).toEqual([otherAgent]);
    expect(await claimsByAgentAndDate(db, 'muse', '2026-10-02')).toEqual([nextDay]);
  });

  it('rejects a malformed date or agent', async () => {
    await upsertClaim(db, makeClaim());
    await expectLedgerError(claimsByAgentAndDate(db, 'muse', '2026-13-01'), 'invalid_input');
    await expectLedgerError(claimsByAgentAndDate(db, 'muse', '2026-10-01T00:00:00Z'), 'invalid_input');
    await expectLedgerError(claimsByAgentAndDate(db, 'bard' as never, '2026-10-01'), 'invalid_input');
  });
});
