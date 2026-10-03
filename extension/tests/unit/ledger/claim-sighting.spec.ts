/**
 * R4-LEDGER-CLAIM-LATE (Hard Rules 4, 6): a claim's sighting grades nothing. Its stored `observedAt` only decides
 * which batches read it (docs/grading.md §3, §10), so a re-read of a stored rawHash is a no-op (`inserted: false`)
 * however early it was sighted, never `late_sighting`: refusing it turned the adapter DEGRADED for nothing. An
 * observation keeps the refusal, because §4.1's `calendar.created` rule and the §7 anchor read its first sighting.
 * The verifier's probe repro-r4 part B, and a property: a stored claim never changes, whatever re-reads follow.
 */
import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import {
  getClaim,
  getObservation,
  recordBatchInstant,
  upsertClaim,
  upsertObservation,
} from '../../../src/ledger/repo';
import { Claim, Observation } from '../../../src/ledger/types';
import {
  buildClaim,
  buildObservation,
  isoAt,
  makePolicies,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  START_MS,
} from '../../tools/attest-world';
import { captureLogs, expectLedgerError, pinClock, releaseClock, uniqueDbName } from './fixtures';

let db: LedgerDb;
let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  pinClock();
  db = await openLedger(uniqueDbName('claim-sighting'));
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  db.close();
  releaseClock();
});

const POLICY = makePolicies()[0].policy;
/** 14:00:00.000 on the third day: when tab A sighted both rows. */
const BASE = START_MS + 2 * MS_PER_DAY + 14 * MS_PER_HOUR;
const CLAIM = buildClaim(1, {
  agent: 'muse',
  type: 'email.sent',
  counterparty: 'priya@acme.io',
  claimedAt: isoAt(BASE - 10 * MS_PER_MINUTE),
  observedAt: isoAt(BASE),
});
const OBSERVATION = buildObservation(1, {
  type: 'email.sent',
  source: 'gmail.sent',
  counterparty: 'priya@acme.io',
  subjectHint: 'q3',
  occurredAt: isoAt(BASE - 10 * MS_PER_MINUTE),
  observedAt: isoAt(BASE),
});

/** `row` sighted at `sightedMs`. */
const claimAt = (sightedMs: number) => Claim.parse({ ...CLAIM, observedAt: isoAt(sightedMs) });
const observationAt = (sightedMs: number) =>
  Observation.parse({ ...OBSERVATION, observedAt: isoAt(sightedMs) });

describe('a re-read of a stored claim is a no-op, however early it was sighted (probe repro-r4 B)', () => {
  /** Tab A sighted both rows at 14:00:00; its writes land at 14:00:05, so both are stored at 14:00:05. */
  async function storedByTabA(): Promise<{ claim: Claim; observation: Observation }> {
    pinClock(isoAt(BASE + 5000));
    expect(await upsertClaim(db, CLAIM)).toEqual({ id: CLAIM.id, inserted: true });
    expect(await upsertObservation(db, OBSERVATION, POLICY)).toEqual({ id: OBSERVATION.id, inserted: true });
    const claim = await getClaim(db, CLAIM.id);
    const observation = await getObservation(db, OBSERVATION.id);
    if (claim === undefined || observation === undefined) throw new Error('tab A wrote nothing');
    expect(Date.parse(claim.observedAt)).toBe(BASE + 5000);
    expect(observation).toMatchObject({ sightedAt: isoAt(BASE) });
    return { claim, observation };
  }

  it('tab B sighted both at 14:00:03 and writes at 14:00:06: both are no-ops; nothing changes', async () => {
    const stored = await storedByTabA();
    pinClock(isoAt(BASE + 6000));
    expect(await upsertClaim(db, claimAt(BASE + 3000))).toEqual({ id: CLAIM.id, inserted: false });
    expect(await upsertObservation(db, observationAt(BASE + 3000), POLICY)).toEqual({
      id: OBSERVATION.id,
      inserted: false,
    });
    expect(await getClaim(db, CLAIM.id)).toEqual(stored.claim);
    expect(await getObservation(db, OBSERVATION.id)).toEqual(stored.observation);
  });

  it("a sighting before tab A's: the claim is a no-op, the observation is still refused", async () => {
    const stored = await storedByTabA();
    pinClock(isoAt(BASE + 6000));
    expect(await upsertClaim(db, claimAt(BASE - 1000))).toEqual({ id: CLAIM.id, inserted: false });
    expect(await upsertClaim(db, claimAt(BASE - MS_PER_DAY))).toEqual({ id: CLAIM.id, inserted: false });
    await expectLedgerError(upsertObservation(db, observationAt(BASE - 1000), POLICY), 'late_sighting');
    expect(await getClaim(db, CLAIM.id)).toEqual(stored.claim);
    expect(await getObservation(db, OBSERVATION.id)).toEqual(stored.observation);
    expect(await db.claims.count()).toBe(1);
  });
});

/** One re-read: when it was sighted and when its write lands, relative to BASE, and whether a batch ran first. */
const REREAD = fc.record({
  sightedMs: fc.integer({ min: -2 * MS_PER_DAY, max: 2 * MS_PER_DAY }),
  writeMs: fc.integer({ min: -2 * MS_PER_DAY, max: 2 * MS_PER_DAY }),
  batchFirst: fc.boolean(),
});

describe('property: a stored claim never changes, and every re-read of it is a no-op', () => {
  it('any sightings, any write clocks (stepping back too), batches between them', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(REREAD, { minLength: 1, maxLength: 8 }), async (rereads) => {
        const ledger = await openLedger(uniqueDbName('claim-sighting-prop'));
        try {
          pinClock(isoAt(BASE));
          await upsertClaim(ledger, CLAIM);
          const first = await getClaim(ledger, CLAIM.id);
          let lastBatchMs = Number.NEGATIVE_INFINITY;
          for (const { sightedMs, writeMs, batchFirst } of rereads) {
            pinClock(isoAt(BASE + writeMs));
            if (batchFirst && BASE + writeMs > lastBatchMs) {
              await recordBatchInstant(ledger, isoAt(BASE + writeMs));
              lastBatchMs = BASE + writeMs;
            }
            const result = await upsertClaim(ledger, claimAt(BASE + sightedMs));
            expect(result).toEqual({ id: CLAIM.id, inserted: false });
            expect(await getClaim(ledger, CLAIM.id)).toEqual(first);
          }
          expect(await ledger.claims.count()).toBe(1);
        } finally {
          ledger.close();
        }
      }),
      { numRuns: 100 },
    );
  });
});
