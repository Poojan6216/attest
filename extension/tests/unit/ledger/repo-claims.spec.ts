import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { claimsByAgentAndDate, getClaim, upsertClaim } from '../../../src/ledger/repo';
import type { ClaimInput } from '../../../src/ledger/types';
import {
  captureLogs,
  claimId,
  expectLedgerError,
  makeClaim,
  omit,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

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
    // §10 v1.4: the same rawHash always has the same id, so a re-sighting is the same claim read again later.
    const again = makeClaim({ observedAt: '2026-10-01T11:00:00-04:00' });
    expect(again.id).toBe(first.id);
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

  it('rejects an existing id with a different rawHash before the repo sees it (§10 v1.4)', async () => {
    await upsertClaim(db, makeClaim());
    // The schema requires id = idFromHash(rawHash), so this input is invalid, not an id conflict.
    const moved = makeClaim({ id: claimId(101), rawHash: sha(999) });
    await expectLedgerError(upsertClaim(db, moved), 'invalid_input');
    expect(await getClaim(db, makeClaim().id)).toEqual(makeClaim());
    // A different rawHash is a different claim, with its own id.
    expect(await upsertClaim(db, makeClaim({ rawHash: sha(999) }))).toEqual({
      id: claimId(999),
      inserted: true,
    });
  });
});

describe('upsertClaim: a rawHash read again keeps its earliest observedAt (§4.1, OBS-2)', () => {
  it('a sighting that lands late, then an earlier one: the earlier observedAt is stored', async () => {
    const late = makeClaim({ observedAt: '2026-10-01T11:00:00-04:00' });
    const early = makeClaim({ observedAt: '2026-10-01T10:20:00-04:00' });
    await upsertClaim(db, late);
    expect(await upsertClaim(db, early)).toEqual({ id: late.id, inserted: false });
    expect(await getClaim(db, late.id)).toEqual(early);
    expect(await upsertClaim(db, late)).toEqual({ id: late.id, inserted: false });
    expect(await getClaim(db, late.id)).toEqual(early);
    expect(await claimsByAgentAndDate(db, 'muse', '2026-10-01')).toEqual([early]);
  });
});

describe('upsertClaim: one rawHash, one claim (OBS-4)', () => {
  const EDITS: readonly (readonly [string, Partial<ClaimInput>])[] = [
    ['counterparty', { counterparty: 'mallory@evil.example' }],
    ['type, amount and currency', { type: 'purchase.made', amountCents: 999_999, currency: 'USD' }],
    ['extractor version', { extractor: { id: 'muse.activity', version: '2.0.0', confidence: 0.9 } }],
    ['extractor confidence', { extractor: { id: 'muse.activity', version: '1.0.0', confidence: 0.5 } }],
    ['requestId', { requestId: ulid(202) }],
    ['subjectHint (dropped)', { subjectHint: undefined }],
    ['claimedAt', { claimedAt: '2026-10-01T10:15:00-04:00' }],
  ];

  it.each(EDITS)(
    'a claim with a different %s under a stored rawHash throws id_conflict',
    async (_label, edit) => {
      const first = makeClaim();
      await upsertClaim(db, first);
      const logs = captureLogs();
      try {
        const error = await expectLedgerError(upsertClaim(db, makeClaim(edit)), 'id_conflict');
        expect(error.context).toEqual({ table: 'claims', id: first.id });
        expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('mallory');
      } finally {
        logs.restore();
      }
      expect(JSON.stringify(logs.records)).not.toContain('mallory');
      expect(await getClaim(db, first.id)).toEqual(first);
      expect(await db.claims.count()).toBe(1);
    },
  );

  it('a different claim that claims an earlier sighting changes nothing, its observedAt included', async () => {
    const first = makeClaim();
    await upsertClaim(db, first);
    const edited = makeClaim({
      counterparty: 'mallory@evil.example',
      observedAt: '2026-10-01T10:00:00-04:00',
    });
    await expectLedgerError(upsertClaim(db, edited), 'id_conflict');
    expect(await getClaim(db, first.id)).toEqual(first);
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
    const lateNight = makeClaim({ rawHash: sha(1), claimedAt: '2026-10-01T23:50:00-04:00' });
    const morning = makeClaim({ rawHash: sha(2), claimedAt: '2026-10-01T08:00:00-04:00' });
    const nextDay = makeClaim({ rawHash: sha(3), claimedAt: '2026-10-02T08:00:00-04:00' });
    const otherAgent = makeClaim({ rawHash: sha(4), agent: 'claude' });
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
