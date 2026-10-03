import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { claimsByAgentAndDate, getClaim, upsertClaim } from '../../../src/ledger/repo';
import { Claim, type ClaimInput } from '../../../src/ledger/types';
import {
  captureLogs,
  claimId,
  expectLedgerError,
  makeClaim,
  omit,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

let db: LedgerDb;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('claims'));
});

afterEach(() => {
  db.close();
  releaseClock();
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

describe('upsertClaim: a stored claim never moves (§3, R3-LEDGER-1, RP3-3, R4-LEDGER-CLAIM-LATE)', () => {
  // A claim's sighting grades nothing (§3, §10), so an earlier re-read is a no-op, never late_sighting.
  it('a sighting earlier than the stored one is a no-op and changes nothing', async () => {
    const late = makeClaim({ observedAt: '2026-10-01T11:00:00-04:00' });
    const early = makeClaim({ observedAt: '2026-10-01T10:20:00-04:00' });
    await upsertClaim(db, late);
    expect(await upsertClaim(db, early)).toEqual({ id: late.id, inserted: false });
    expect(await getClaim(db, late.id)).toEqual(late);
    expect(await upsertClaim(db, late)).toEqual({ id: late.id, inserted: false });
    expect(await db.claims.count()).toBe(1);
    expect(await claimsByAgentAndDate(db, 'muse', '2026-10-01')).toEqual([late]);
  });

  it('a newer extractor that reads the claim with an earlier sighting is a no-op; the stored one is kept', async () => {
    const stored = makeClaim();
    await upsertClaim(db, stored);
    const reread = makeClaim({
      observedAt: '2026-10-01T10:29:00-04:00',
      extractor: { id: 'muse.activity', version: '1.0.1', confidence: 0.9 },
    });
    expect(await upsertClaim(db, reread)).toEqual({ id: stored.id, inserted: false });
    expect(await getClaim(db, stored.id)).toEqual(stored);
  });

  it('an earlier sighting that differs in a field is still an id_conflict', async () => {
    const stored = makeClaim();
    await upsertClaim(db, stored);
    const other = makeClaim({ observedAt: '2026-10-01T10:20:00-04:00', counterparty: 'bob@example.com' });
    await expectLedgerError(upsertClaim(db, other), 'id_conflict');
    expect(await getClaim(db, stored.id)).toEqual(stored);
  });
});

type Outcome = 'id_conflict' | 'invalid_input' | 'kept';

/** A claim with every optional field a minute-precision claim can hold. */
const FULL = makeClaim({ amountCents: 1250, currency: 'USD', targetAt: '2026-10-02T09:00:00-04:00' });
/** A day-precision claim, the only kind that holds `claimedAtEnd` (§4.1). */
const DAY: ClaimInput = { ...FULL, claimedAtPrecision: 'day', claimedAtEnd: '2026-10-02T00:00:00-04:00' };
const LATER = '2026-10-02T08:00:00-04:00';

/**
 * One row per Claim field but `observedAt` (the sighting), each changed alone (R3-LEDGER-4): the field, the
 * stored claim, the edit, and what a re-read under the same rawHash does. No field but the rawHash and the id is
 * in the rawHash the ledger can check (§10), so each content field must be compared on its own.
 */
const FIELD_EDITS: readonly (readonly [string, ClaimInput, Partial<ClaimInput>, Outcome])[] = [
  ['id', FULL, { id: claimId(999) }, 'invalid_input'],
  ['agent', FULL, { agent: 'claude' }, 'id_conflict'],
  ['requestId', FULL, { requestId: ulid(202) }, 'id_conflict'],
  ['type', FULL, { type: 'purchase.made' }, 'id_conflict'],
  ['counterparty', FULL, { counterparty: 'mallory@evil.example' }, 'id_conflict'],
  ['amountCents', FULL, { amountCents: 125_000 }, 'id_conflict'],
  ['currency', FULL, { currency: 'EUR' }, 'id_conflict'],
  ['subjectHint', FULL, { subjectHint: 'Other numbers' }, 'id_conflict'],
  ['claimedAt', FULL, { claimedAt: '2026-10-01T10:15:00-04:00' }, 'id_conflict'],
  ['claimedAtPrecision', FULL, { claimedAtPrecision: 'hour' }, 'id_conflict'],
  ['claimedAtEnd', DAY, { claimedAtEnd: '2026-10-01T23:00:00-04:00' }, 'id_conflict'],
  ['targetAt', FULL, { targetAt: '2026-10-02T10:00:00-04:00' }, 'id_conflict'],
  ['sourceKind', FULL, { sourceKind: 'chat' }, 'id_conflict'],
  ['extractor', FULL, { extractor: { id: 'muse.chat', version: '2.0.0', confidence: 0.5 } }, 'kept'],
  ['rawHash', FULL, { rawHash: sha(999) }, 'invalid_input'],
];

/** Each optional field dropped alone: a re-read that lost a field is another reading (OBS-4). */
const DROPS: readonly (readonly [string, ClaimInput, ClaimInput])[] = [
  ['requestId', FULL, omit(FULL, 'requestId')],
  ['counterparty', FULL, omit(FULL, 'counterparty')],
  ['amountCents', FULL, omit(FULL, 'amountCents')],
  ['currency', FULL, omit(FULL, 'currency')],
  ['subjectHint', FULL, omit(FULL, 'subjectHint')],
  ['targetAt', FULL, omit(FULL, 'targetAt')],
  ['claimedAtEnd', DAY, omit(DAY, 'claimedAtEnd')],
];

describe('upsertClaim: one rawHash, one claim (OBS-4, R3-LEDGER-3, R3-LEDGER-4)', () => {
  it('names every Claim field but observedAt, each changed alone', () => {
    const fields = FIELD_EDITS.map(([field]) => field);
    expect([...fields].sort()).toEqual(
      Object.keys(Claim.shape)
        .filter((key) => key !== 'observedAt')
        .sort(),
    );
    for (const [field, , edit] of FIELD_EDITS) expect(Object.keys(edit)).toEqual([field]);
  });

  it.each(FIELD_EDITS)('%s changed alone under a stored rawHash', async (_field, stored, edit, outcome) => {
    await upsertClaim(db, stored);
    const logs = captureLogs();
    try {
      const reread = upsertClaim(db, { ...stored, ...edit, observedAt: LATER });
      if (outcome === 'kept') expect(await reread).toEqual({ id: stored.id, inserted: false });
      else {
        const error = await expectLedgerError(reread, outcome);
        if (outcome === 'id_conflict')
          expect(error.context).toStrictEqual({ table: 'claims', id: stored.id });
        // The schema ties the id to the rawHash (§10): either changed alone is refused at `id`.
        else expect(error.context).toStrictEqual({ table: 'claims', paths: 'id' });
        expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('mallory');
      }
    } finally {
      logs.restore();
    }
    expect(JSON.stringify(logs.records)).not.toContain('mallory');
    // The stored claim is kept exactly, its extractor and observedAt included (Hard Rule 4).
    expect(await getClaim(db, stored.id)).toEqual(stored);
    expect(await db.claims.count()).toBe(1);
  });

  it.each(DROPS)(
    '%s dropped alone under a stored rawHash throws id_conflict',
    async (_field, stored, dropped) => {
      await upsertClaim(db, stored);
      await expectLedgerError(upsertClaim(db, { ...dropped, observedAt: LATER }), 'id_conflict');
      expect(await getClaim(db, stored.id)).toEqual(stored);
    },
  );
});

describe('upsertClaim: a re-read that differs is refused whatever else it carries (OBS-4)', () => {
  it('a newer extractor that reads the claim differently still throws id_conflict', async () => {
    await upsertClaim(db, FULL);
    const extractor = { id: 'muse.activity', version: '1.0.1', confidence: 0.9 };
    const reread = { ...FULL, extractor, amountCents: 125_000, observedAt: LATER };
    await expectLedgerError(upsertClaim(db, reread), 'id_conflict');
    expect(await getClaim(db, FULL.id)).toEqual(FULL);
  });

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
