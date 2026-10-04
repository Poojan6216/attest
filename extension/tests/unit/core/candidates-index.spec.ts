/**
 * The in-memory ObservationIndex (docs/grading.md §4.2): every read is bounded in time and may over-return
 * only up to whole buckets; tokens come from the address (never the display name) and the merchant; bad
 * arguments fail loud. Each block runs against the memory index and the ledger's Dexie index (Sprint 2.6,
 * tests/unit/ledger/index-implementations.ts); only the memory index takes a bucket width.
 */
import { describe, expect, it } from 'vitest';

import { CandidatesError, counterpartyTokens } from '../../../src/core/candidates';
import { canonicalJson, idFromHash, sha256Hex } from '../../../src/core/hash';
import { type ActionType, Observation } from '../../../src/core/schema';
import { MS_PER_MINUTE } from '../../../src/core/units';
import { INDEX_IMPLEMENTATIONS } from '../ledger/index-implementations';

function obs(occurredAt: string, extra: Record<string, unknown> = {}, type: ActionType = 'email.sent') {
  const content = { source: 'gmail.sent', type, occurredAt, counterparty: 'priya@company.com', ...extra };
  const contentHash = sha256Hex(canonicalJson(content));
  return Observation.parse({ ...content, id: idFromHash(contentHash), contentHash, observedAt: occurredAt });
}

const ms = (iso: string) => Date.parse(iso);
const eachIndex = describe.each(INDEX_IMPLEMENTATIONS);

/** One observation every 7 minutes over 10 hours: no bucket boundary lines up with the rows. */
const ROWS = Array.from({ length: 86 }, (_, i) =>
  obs(new Date(ms('2026-10-06T08:00:00Z') + i * 7 * MS_PER_MINUTE).toISOString()),
);

eachIndex('byTypeAndBucket: bounded reads ($name index)', (impl) => {
  it.each([1, 5, 15, 60, 240])(
    '%i-minute buckets: every row in range, nothing outside the widened buckets',
    async (bucketMinutes) => {
      const index = impl.createIndex(ROWS, bucketMinutes);
      const fromMs = ms('2026-10-06T10:03:00Z');
      const toMs = ms('2026-10-06T12:41:00Z');
      const bucketMs = bucketMinutes * MS_PER_MINUTE;
      const lowest = Math.floor(fromMs / bucketMs) * bucketMs;
      const highest = (Math.floor(toMs / bucketMs) + 1) * bucketMs;
      const read = await index.byTypeAndBucket('email.sent', fromMs, toMs);
      const readMs = read.map((o) => ms(o.occurredAt));
      const wanted = ROWS.filter((o) => ms(o.occurredAt) >= fromMs && ms(o.occurredAt) <= toMs);
      expect(read).toEqual(expect.arrayContaining(wanted));
      expect(readMs.every((t) => t >= lowest && t < highest)).toBe(true);
      expect(readMs).toEqual([...readMs].sort((a, b) => a - b));
    },
  );

  it('with 1-minute buckets and minute-aligned bounds the read is exact', async () => {
    const index = impl.createIndex(ROWS, 1);
    const read = await index.byTypeAndBucket(
      'email.sent',
      ms('2026-10-06T08:07:00Z'),
      ms('2026-10-06T08:20:59.999Z'),
    );
    expect(read.map((o) => o.occurredAt)).toEqual(['2026-10-06T08:07:00.000Z', '2026-10-06T08:14:00.000Z']);
  });

  it('returns nothing for another type, an empty range, or a range with no rows', async () => {
    const index = impl.createIndex(ROWS, 15);
    expect(
      await index.byTypeAndBucket('purchase.made', ms('2026-10-06T00:00:00Z'), ms('2026-10-07T00:00:00Z')),
    ).toEqual([]);
    expect(
      await index.byTypeAndBucket('email.sent', ms('2026-10-06T12:00:00Z'), ms('2026-10-06T11:00:00Z')),
    ).toEqual([]);
    expect(
      await index.byTypeAndBucket('email.sent', ms('2026-10-07T12:00:00Z'), ms('2026-10-07T13:00:00Z')),
    ).toEqual([]);
  });

  it('indexes by instant: a row written at -04:00 is found by its UTC instant', async () => {
    const row = obs('2026-10-06T22:30:00-04:00');
    const index = impl.createIndex([row], 1);
    expect(
      await index.byTypeAndBucket('email.sent', ms('2026-10-07T02:30:00Z'), ms('2026-10-07T02:30:00Z')),
    ).toEqual([row]);
  });
});

eachIndex('bad arguments fail loud ($name index)', (impl) => {
  it('rejects a bound that is not a safe integer of ms (fail loud, Hard Rule 6)', async () => {
    const index = impl.createIndex(ROWS, 15);
    for (const bad of [Number.NaN, 1.5, Number.POSITIVE_INFINITY, 2 ** 53]) {
      await expect(index.byTypeAndBucket('email.sent', bad, 0)).rejects.toThrow(CandidatesError);
      await expect(index.byCounterpartyToken('priya', 0, bad)).rejects.toMatchObject({
        code: 'invalid_range',
      });
    }
  });

  it.runIf(impl.bucketed).each([0, -15, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
    'rejects bucketMinutes %s',
    (bucketMinutes) => {
      expect(() => impl.createIndex(ROWS, bucketMinutes)).toThrow(
        expect.objectContaining({ code: 'invalid_bucket' }),
      );
    },
  );
});

eachIndex('counterpartyTokens and byCounterpartyToken ($name index)', (impl) => {
  it('an address yields itself, its domain and its local-part tokens without the +tag, ASCII-lowercased', () => {
    expect(counterpartyTokens({ counterparty: 'Priya.Shah-Iyer+news@Company.COM' })).toEqual([
      'company.com',
      'iyer',
      'priya',
      'priya.shah-iyer+news@company.com',
      'shah',
    ]);
  });

  it('separators at either end of the local part leave no empty token', () => {
    expect(counterpartyTokens({ counterparty: '_priya-@company.com' })).toEqual([
      '_priya-@company.com',
      'company.com',
      'priya',
    ]);
  });

  it('a display name is never indexed: it is attacker-controlled', () => {
    expect(counterpartyTokens({ counterparty: '"Priya" <attacker@evil.example>' })).toEqual([
      'attacker',
      'attacker@evil.example',
      'evil.example',
    ]);
  });

  it('a merchant yields its name tokens; nothing yields nothing', () => {
    expect(counterpartyTokens({ merchant: 'Blue Bottle Caf\u00e9' })).toEqual(['blue', 'bottle', 'cafe']);
    expect(counterpartyTokens({})).toEqual([]);
    expect(counterpartyTokens({ counterparty: 'not an address' })).toEqual([]);
  });

  it('byCounterpartyToken reads only rows carrying the token, bounded in time', async () => {
    const priya = obs('2026-10-06T14:02:00Z');
    const raj = obs('2026-10-06T14:03:00Z', { counterparty: 'raj@company.com' });
    const late = obs('2026-10-06T20:00:00Z');
    const index = impl.createIndex([priya, raj, late], 15);
    const from = ms('2026-10-06T14:00:00Z');
    const to = ms('2026-10-06T14:30:00Z');
    expect(await index.byCounterpartyToken('priya', from, to)).toEqual([priya]);
    expect(await index.byCounterpartyToken('company.com', from, to)).toEqual([priya, raj]);
    expect(await index.byCounterpartyToken('nobody', from, to)).toEqual([]);
  });
});
