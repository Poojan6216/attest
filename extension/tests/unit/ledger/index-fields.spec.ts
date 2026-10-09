import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LEDGER_TIME_BUCKET_MINUTES } from '../../../src/config';
import { LedgerError } from '../../../src/ledger/errors';
import {
  INDEX_FIELDS,
  LEDGER_TABLE_NAMES,
  REPLAY_TABLE_NAMES,
  accountKeyOf,
  dateKey,
  stripIndexFields,
  timeBucketOf,
  toClaimRow,
  toCoverageRow,
  toObservationRow,
  toReceiptRow,
  toRequestRow,
} from '../../../src/ledger/index-fields';
import { Claim, CoveragePing, Observation, Receipt, Request } from '../../../src/ledger/types';
import { makeClaim, makeObservation, makePing, makeReceipt, makeRequest, omit, sha } from './fixtures';

const BUCKET_MS = LEDGER_TIME_BUCKET_MINUTES * 60_000;

/** `ms` written as local wall-clock time at `offsetMinutes` from UTC, e.g. `2026-10-01T06:00:00.000-04:00`. */
function withOffset(ms: number, offsetMinutes: number): string {
  const wallClock = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 23);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${wallClock}${sign}${hh}:${mm}`;
}

describe('dateKey', () => {
  it('is the local date of the recorded offset, not the UTC date', () => {
    // 23:30 at -04:00 is 03:30Z the next day; the user lived it on Oct 1.
    expect(dateKey('2026-10-01T23:30:00-04:00')).toBe('2026-10-01');
    expect(dateKey('2026-10-02T03:30:00Z')).toBe('2026-10-02');
  });

  it('keeps the date of fractional-second timestamps', () => {
    expect(dateKey('2026-01-31T00:00:00.123+14:00')).toBe('2026-01-31');
  });
});

describe('timeBucketOf', () => {
  it('puts the same instant in the same bucket whatever its offset', () => {
    const utc = timeBucketOf('2026-10-01T14:15:00Z');
    expect(timeBucketOf('2026-10-01T10:15:00-04:00')).toBe(utc);
    expect(timeBucketOf('2026-10-01T19:45:00+05:30')).toBe(utc);
    expect(utc).toBe(Math.floor(Date.parse('2026-10-01T14:15:00Z') / BUCKET_MS));
  });

  it('changes bucket exactly at the bucket boundary', () => {
    const boundaryMs = Math.ceil(Date.parse('2026-10-01T14:15:00Z') / BUCKET_MS) * BUCKET_MS;
    const atBoundary = new Date(boundaryMs).toISOString();
    const justBefore = new Date(boundaryMs - 1).toISOString();
    expect(timeBucketOf(atBoundary) - timeBucketOf(justBefore)).toBe(1);
  });

  it('rejects an unparseable timestamp with invalid_input', () => {
    let caught: unknown;
    try {
      timeBucketOf('not-a-time');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LedgerError);
    expect(caught).toMatchObject({ code: 'invalid_input' });
  });
});

describe('stripIndexFields', () => {
  it("removes exactly the table's derived keys and keeps everything else", () => {
    const row = { ...makeObservation(), timeBucket: 5, body: 'smuggled' };
    const stripped = stripIndexFields('observations', row);
    expect(stripped).toEqual({ ...makeObservation(), body: 'smuggled' });
    // A smuggled key survives the strip, so the strict schema still rejects the row.
    expect(Observation.safeParse(stripped).success).toBe(false);
  });

  it("keeps a receipt's agent: it is a domain field, not a derived one", () => {
    const row = toReceiptRow(Receipt.parse(makeReceipt({ agent: 'claude' })));
    expect(INDEX_FIELDS.receipts).toEqual(['date', 'computedMs']);
    expect(stripIndexFields('receipts', row)).toEqual(makeReceipt({ agent: 'claude' }));
  });

  it('passes non-objects through unchanged and declares fields for every table', () => {
    expect(stripIndexFields('meta', 'text')).toBe('text');
    expect(stripIndexFields('meta', null)).toBeNull();
    expect(Object.keys(INDEX_FIELDS).sort()).toEqual([...LEDGER_TABLE_NAMES, ...REPLAY_TABLE_NAMES].sort());
  });
});

describe('row builders', () => {
  it('derive the documented index fields', () => {
    expect(toRequestRow(Request.parse(makeRequest())).date).toBe('2026-10-01');
    const lateClaim = Claim.parse(makeClaim({ claimedAt: '2026-10-01T23:59:00-07:00' }));
    expect(toClaimRow(lateClaim).date).toBe('2026-10-01');
    const receipt = Receipt.parse(makeReceipt({ agent: 'claude' }));
    expect(toReceiptRow(receipt)).toMatchObject({ agent: 'claude', date: '2026-10-01' });
    expect(toCoverageRow(CoveragePing.parse(makePing())).accountKey).toBe(sha(900));
    expect(toCoverageRow(CoveragePing.parse(omit(makePing(), 'accountHash'))).accountKey).toBe('');
    expect(accountKeyOf(undefined)).toBe('');
  });

  it('round-trip: strip(toRow(x)) is exactly x and still strict-parses (property)', () => {
    const instant = fc.date({
      min: new Date('2000-01-01T00:00:00Z'),
      max: new Date('2099-12-31T23:59:59Z'),
      noInvalidDate: true,
    });
    // Real-world offsets (-12:00 … +14:00, quarter hours), so the property also covers non-UTC timestamps.
    const offsetMinutes = fc.integer({ min: -48, max: 56 }).map((quarters) => quarters * 15);
    const stamp = fc
      .tuple(instant, offsetMinutes)
      .map(([date, offset]) => ({ ts: withOffset(date.getTime(), offset), ms: date.getTime(), offset }));
    fc.assert(
      fc.property(stamp, stamp, fc.integer({ min: 1, max: 1_000_000 }), (at, other, n) => {
        const [a, b] = [at.ts, other.ts];
        const observation = Observation.parse(
          makeObservation({ occurredAt: a, observedAt: b, contentHash: sha(n) }),
        );
        const claim = Claim.parse(makeClaim({ claimedAt: a, observedAt: b }));
        const request = Request.parse(makeRequest({ ts: a }));
        const receipt = Receipt.parse(makeReceipt({ computedAt: a }));
        const ping = CoveragePing.parse(makePing({ lastSyncAt: a }));
        expect(Observation.parse(stripIndexFields('observations', toObservationRow(observation)))).toEqual(
          observation,
        );
        expect(Claim.parse(stripIndexFields('claims', toClaimRow(claim)))).toEqual(claim);
        expect(Request.parse(stripIndexFields('requests', toRequestRow(request)))).toEqual(request);
        expect(Receipt.parse(stripIndexFields('receipts', toReceiptRow(receipt)))).toEqual(receipt);
        expect(CoveragePing.parse(stripIndexFields('coverage', toCoverageRow(ping)))).toEqual(ping);
        // The bucket is the instant's, whatever the offset; the date is the wall-clock date at that offset.
        expect(toObservationRow(observation).timeBucket).toBe(Math.floor(at.ms / BUCKET_MS));
        expect(toClaimRow(claim).date).toBe(new Date(at.ms + at.offset * 60_000).toISOString().slice(0, 10));
      }),
      { numRuns: 1_000 },
    );
  });
});
