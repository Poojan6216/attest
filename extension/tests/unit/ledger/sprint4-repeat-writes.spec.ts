import 'fake-indexeddb/auto';
/**
 * The Sprint 4 ledger methods written or read twice, or over what is not there (qa_tester rule 3: two tests per repo
 * method, the happy one and the duplicate or conflict; Sprint 4 QA review). Each method's happy path has its own spec;
 * these are the repeats:
 *  - `saveGrant` (src/ledger/grant-save.ts): the same choices saved twice keep one row per agent, stamped no earlier
 *    than the first, with what Attest observed kept and the mute as last saved; an agent with no stored grant gets
 *    none of what Attest observed, and no currency without a ceiling;
 *  - `saveDigest`, `getDigest`, `digestWeeks` (src/ledger/digest.ts): a week never made reads as none, an empty ledger
 *    lists no week, and a stored digest that fails its strict read reads as none, logged by its key only;
 *  - `buildDigest` past its cap: a week with more notable receipts than a digest keeps keeps the newest and counts all,
 *    and the share says how many more;
 *  - `recordAutoCheck`, `readAutoCheck` (src/ledger/auto-check-record.ts): a second open replaces the first whole; a
 *    record missing a key reads as none; a record its reader would refuse is never written;
 *  - `eachPage` (src/ledger/export-file.ts): an empty table gives no page, and a table of exactly two pages gives two;
 *  - `deleteLedger` (src/ledger/shared.ts): deleting twice is safe, and the next open is the empty, latest ledger.
 * Every value is invented.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isoWithLocalOffset } from '../../../src/clock';
import { alertsMutedKey } from '../../../src/ledger/agent-keys';
import { AUTO_CHECK_CLAIMS, readAutoCheck, recordAutoCheck } from '../../../src/ledger/auto-check-record';
import type { LedgerDb } from '../../../src/ledger/db';
import { buildDigest, digestWeeks, getDigest, saveDigest } from '../../../src/ledger/digest';
import { lastWeek } from '../../../src/ledger/digest-week';
import { eachPage } from '../../../src/ledger/export-file';
import { saveGrant } from '../../../src/ledger/grant-save';
import { openLedger } from '../../../src/ledger/migrations';
import { getGrant, getMeta, putGrant, putReceipt, upsertClaim } from '../../../src/ledger/repo';
import { closeLedger, deleteLedger, getLedger } from '../../../src/ledger/shared';
import { DigestRecord, type GrantChoices, IsoTs, SCHEMA_LIMITS } from '../../../src/ledger/types';
import { type LogRecord, setLogSink } from '../../../src/log';
import { digestMarkdown } from '../../../src/ui/digest-share';
import {
  claimId,
  makeClaim,
  makeGrant,
  makeReceipt,
  pinClock,
  releaseClock,
  sha,
  ulid,
  uniqueDbName,
} from './fixtures';

let db: LedgerDb;
let records: LogRecord[];
let restore: () => void;

beforeEach(async () => {
  pinClock('2026-10-08T17:00:00-04:00');
  db = await openLedger(uniqueDbName('sprint4-repeats'));
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(() => {
  restore();
  db.close();
  releaseClock();
});

const CHOICES: GrantChoices = {
  agent: 'muse',
  allowedTypes: ['email.sent'],
  counterpartyAllowlist: ['company.example'],
  spendCeilingCents: 5000,
  spendCurrency: 'USD',
  declaredScopes: ['gmail.send'],
};

describe('saveGrant, twice', () => {
  it('keeps one grant per agent, stamped no earlier than the first, what Attest observed kept, the mute as last saved', async () => {
    const accounts = { 'gmail.sent': [sha(7)] };
    await putGrant(db, makeGrant({ observedScopes: ['gmail.read'], accounts }));
    const first = await saveGrant(db, CHOICES, true);
    const second = await saveGrant(db, CHOICES, false);
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
    expect(await db.grants.count()).toBe(1);
    expect(await getGrant(db, 'muse')).toEqual({
      ...CHOICES,
      observedScopes: ['gmail.read'],
      accounts,
      updatedAt: second,
    });
    expect(await getMeta(db, alertsMutedKey('muse'))).toBe(false);
  });

  it('gives an agent with no stored grant nothing Attest observed, and no currency without a ceiling', async () => {
    const at = await saveGrant(
      db,
      {
        agent: 'claude',
        allowedTypes: [],
        counterpartyAllowlist: [],
        spendCeilingCents: null,
        declaredScopes: [],
      },
      false,
    );
    expect(await getGrant(db, 'claude')).toEqual({
      agent: 'claude',
      allowedTypes: [],
      counterpartyAllowlist: [],
      spendCeilingCents: null,
      declaredScopes: [],
      updatedAt: at,
    });
    expect(await getGrant(db, 'muse')).toBeUndefined();
  });
});

const digest = (week: string): DigestRecord =>
  DigestRecord.parse({
    week,
    from: `${week}T00:00:00.000-04:00`,
    to: '2026-10-12T00:00:00.000-04:00',
    createdAt: '2026-10-12T09:00:00.000-04:00',
    agents: [],
    notable: [],
    notableCount: 0,
    gaps: [],
    health: [],
  });

describe('digests that are not there', () => {
  it('lists no week in an empty ledger, and reads a week never made as none', async () => {
    expect(await digestWeeks(db)).toEqual([]);
    expect(await getDigest(db, '2026-10-05')).toBeUndefined();
    await saveDigest(db, digest('2026-10-05'));
    expect(await getDigest(db, '2026-09-28')).toBeUndefined();
  });

  it('reads a stored digest that fails its strict read as none, logged by its key only', async () => {
    const corrupt = { ...digest('2026-10-05'), notableCount: -1, notes: 'Lunch with Dana' };
    await db.digests.put(corrupt);
    expect(await getDigest(db, '2026-10-05')).toBeUndefined();
    expect(records.some(({ event }) => event === 'ledger.row_invalid')).toBe(true);
    expect(JSON.stringify(records)).not.toContain('Lunch with Dana');
    await expect(saveDigest(db, { ...digest('2026-10-05'), notableCount: -1 })).rejects.toThrow();
  });
});

const OPEN = {
  at: IsoTs.parse('2026-10-08T17:00:00-04:00'),
  until: IsoTs.parse('2026-10-08T17:30:00-04:00'),
  claims: 2,
  agents: ['muse', 'claude'],
} as const;

describe('a week with more notable receipts than a digest keeps', () => {
  it(`keeps the newest ${String(SCHEMA_LIMITS.LIST)} and counts them all; made again, it replaces itself`, async () => {
    const week = lastWeek(new Date(2026, 9, 12, 9, 30).getTime());
    const total = SCHEMA_LIMITS.LIST + 3;
    for (let n = 1; n <= total; n += 1) {
      const at = isoWithLocalOffset(new Date(week.fromMs + n * 60_000));
      await putReceipt(
        db,
        makeReceipt({
          id: ulid(n),
          claimId: claimId(n),
          inputsHash: sha(n),
          grade: 'NOT_FOUND',
          ruleId: 'not_found',
          reasons: [{ code: 'match.none', params: {} }],
          observationIds: [],
          state: 'FINAL',
          computedAt: at,
          finalAt: at,
        }),
      );
    }
    const made = IsoTs.parse(isoWithLocalOffset(new Date(week.toMs + 9 * 3_600_000)));
    const built = await buildDigest(db, week, made);
    expect(built.notableCount).toBe(total);
    expect(built.notable.map(({ receiptId }) => receiptId)).toEqual(
      Array.from({ length: SCHEMA_LIMITS.LIST }, (_, index) => ulid(total - index)),
    );
    expect(built.agents.map(({ agent, grades }) => [agent, grades.NOT_FOUND])).toEqual([['muse', total]]);
    await saveDigest(db, built);
    await saveDigest(db, await buildDigest(db, week, made));
    expect(await digestWeeks(db)).toEqual([week.week]);
    expect(digestMarkdown(built)).toContain('- And 3 more.');
  });
});

describe('the auto-check record, twice', () => {
  it('replaces the first open whole with the second', async () => {
    await recordAutoCheck(db, { ...OPEN, agents: [...OPEN.agents] });
    const later = {
      at: IsoTs.parse('2026-10-08T18:00:00-04:00'),
      until: IsoTs.parse('2026-10-08T18:30:00-04:00'),
      claims: 1,
      agents: ['dots' as const],
    };
    await recordAutoCheck(db, later);
    expect(await readAutoCheck(db)).toEqual(later);
  });

  it('reads a record missing a key as none, and never writes one its reader would refuse', async () => {
    await recordAutoCheck(db, { ...OPEN, agents: [...OPEN.agents] });
    await db.meta.delete(AUTO_CHECK_CLAIMS);
    expect(await readAutoCheck(db)).toBeNull();
    await db.meta.clear();
    await expect(recordAutoCheck(db, { ...OPEN, claims: 0, agents: ['muse'] })).rejects.toThrow();
    await expect(recordAutoCheck(db, { ...OPEN, agents: [] })).rejects.toThrow();
    expect(await db.meta.count()).toBe(0);
    expect(await readAutoCheck(db)).toBeNull();
  });
});

describe('eachPage at its edges', () => {
  it('gives no page for an empty table, and exactly two pages for a table of two pages', async () => {
    const pages: number[] = [];
    await eachPage(db.claims, 3, (rows) => pages.push(rows.length));
    expect(pages).toEqual([]);
    for (let n = 1; n <= 6; n += 1) await upsertClaim(db, makeClaim({ rawHash: sha(100 + n) }));
    const ids: string[] = [];
    await eachPage(db.claims, 3, (rows) => {
      pages.push(rows.length);
      ids.push(...rows.map(({ id }) => id));
    });
    expect(pages).toEqual([3, 3]);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(6);
  });
});

describe('deleteLedger, twice', () => {
  it('is safe to run twice, and the next open is the empty ledger at the latest schema', async () => {
    const shared = await getLedger();
    await upsertClaim(shared, makeClaim());
    const version = shared.verno;
    await deleteLedger();
    await deleteLedger();
    const fresh = await getLedger();
    expect(fresh.verno).toBe(version);
    expect(await fresh.claims.count()).toBe(0);
    await closeLedger();
  });
});
