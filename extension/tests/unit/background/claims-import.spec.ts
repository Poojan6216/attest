import 'fake-indexeddb/auto';
/**
 * The service worker's `claims.import` handler (sprint_3 3.13; src/background/claims-import.ts): the claims of an
 * invented pasted log stored one by one, the default grants, the agent's last import, a grading batch, and the
 * answer the side panel shows. A log pasted twice adds nothing; a refusal answers its code; a batch that fails is
 * logged loud and the import still stands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { type ImportContext, onClaimsImport } from '../../../src/background/claims-import';
import { lastImportKey } from '../../../src/background/grading';
import { ClaimsImportMessage } from '../../../src/bus/messages';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { type Claim, IsoTs, Receipt } from '../../../src/core/schema';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getMeta, listGrants, setMeta, upsertClaim } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';
import { pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';

const PASTED_AT = '2026-10-08T17:00:00-04:00';
const LOG = [
  'Today',
  'Sent an email to sam@example.com',
  '4:33 pm',
  'Unsubscribed you from the newsletter',
  '4:40 pm',
];

const opened: LedgerDb[] = [];
let records: LogRecord[] = [];
let restoreSink: () => void = () => undefined;

beforeEach(() => {
  pinClock(PASTED_AT);
  records = [];
  restoreSink = setLogSink((record) => {
    records.push(record);
  });
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  restoreSink();
  releaseClock();
});

function claimsOf(lines: readonly string[]): Claim[] {
  const read = readPastedLog(lines.join('\n'), {
    agent: 'muse',
    pastedAt: IsoTs.parse(PASTED_AT),
    offsetAt: () => -240,
  });
  if (!read.ok) throw new Error(read.refusal);
  return [...read.log.claims];
}

const message = (claims: readonly Claim[], activeAt: readonly string[] = []) =>
  ClaimsImportMessage.parse({ type: 'claims.import', agent: 'muse', claims, activeAt });

async function setup(
  policy = DEFAULT_POLICY,
): Promise<{ db: LedgerDb; ctx: ImportContext; notify: ReturnType<typeof vi.fn> }> {
  const db = await openLedger(uniqueDbName('claims-import'));
  opened.push(db);
  const notify = vi.fn();
  const ctx: ImportContext = {
    db: () => Promise.resolve(db),
    grading: { policy, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() },
    notify,
  };
  return { db, ctx, notify };
}

const receiptsOf = async (db: LedgerDb) => readRows('receipts', Receipt, await db.receipts.toArray());

describe('claims.import', () => {
  it('stores every claim, writes the default grants and the import instant, grades, and answers the counts', async () => {
    const { db, ctx, notify } = await setup();
    const claims = claimsOf(LOG);
    expect(await onClaimsImport(ctx, message(claims))).toEqual({ ok: true, received: 2, added: 2 });
    expect(await db.claims.count()).toBe(2);
    expect((await listGrants(db)).map((grant) => grant.agent).sort()).toEqual([
      'chatgpt',
      'claude',
      'dots',
      'muse',
    ]);
    expect(Date.parse(String(await getMeta(db, lastImportKey('muse'))))).toBe(Date.parse(PASTED_AT));
    const receipts = await receiptsOf(db);
    expect(receipts.map((r) => r.claimId).sort()).toEqual(claims.map((c) => c.id).sort());
    // No Gmail tab was open: the email may still be seen (PENDING); the unsubscribe names nothing to check by.
    const typeOf = new Map<string, Claim['type']>(claims.map((claim) => [claim.id, claim.type]));
    expect(receipts.map((r) => [typeOf.get(r.claimId ?? ''), r.grade, r.state, r.ruleId]).sort()).toEqual([
      ['email.sent', 'UNVERIFIABLE', 'PENDING', 'no_coverage'],
      ['subscription.changed', 'UNVERIFIABLE', 'FINAL', 'underspecified'],
    ]);
    expect(notify.mock.calls).toEqual([[['claims', 'activity', 'grants', 'meta']], [['receipts']]]);
    expect(JSON.stringify(records)).not.toContain('sam@example.com');
  });

  it('stores the minutes the log names as Muse’s session pings, each once (sprint_3 3.14)', async () => {
    const { db, ctx } = await setup();
    const minutes = ['2026-10-08T16:33:00-04:00', '2026-10-08T16:40:00-04:00'];
    await onClaimsImport(ctx, message(claimsOf(LOG), minutes));
    pinClock('2026-10-08T17:05:00-04:00');
    await onClaimsImport(ctx, message(claimsOf(LOG), minutes));
    const rows = await db.activity.toArray();
    expect(rows.map((row) => [row.kind, row.kind === 'session' ? row.agent : null]).sort()).toEqual([
      ['session', 'muse'],
      ['session', 'muse'],
    ]);
  });

  it('a log pasted twice adds nothing the second time', async () => {
    const { db, ctx } = await setup();
    await onClaimsImport(ctx, message(claimsOf(LOG)));
    pinClock('2026-10-08T17:05:00-04:00');
    expect(await onClaimsImport(ctx, message(claimsOf(LOG)))).toEqual({ ok: true, received: 2, added: 0 });
    expect(await db.claims.count()).toBe(2);
  });

  it('answers a refusal with its code; the claims stored before it stay', async () => {
    const { db, ctx } = await setup();
    const [first, second] = claimsOf(LOG);
    if (first === undefined || second === undefined) throw new Error('two claims expected');
    await upsertClaim(db, second);
    const conflicting: Claim = { ...second, type: 'other' };
    expect(await onClaimsImport(ctx, message([first, conflicting]))).toEqual({
      ok: false,
      code: 'id_conflict',
    });
    expect(await db.claims.count()).toBe(2);
    expect(records.map((r) => r.event)).toContain('import.refused');
  });
});

describe('claims.import: the import instant and a failed batch', () => {
  it('never moves the agent’s last import back', async () => {
    const { db, ctx } = await setup();
    await setMeta(db, lastImportKey('muse'), '2026-10-09T09:00:00-04:00');
    await onClaimsImport(ctx, message(claimsOf(LOG)));
    expect(await getMeta(db, lastImportKey('muse'))).toBe('2026-10-09T09:00:00-04:00');
  });

  it('a batch that fails is logged loud, and the import still stands', async () => {
    const { db, ctx } = await setup({ ...DEFAULT_POLICY });
    expect(await onClaimsImport(ctx, message(claimsOf(LOG)))).toEqual({ ok: true, received: 2, added: 2 });
    expect(await db.claims.count()).toBe(2);
    expect(await db.receipts.count()).toBe(0);
    expect(records.filter((r) => r.level === 'error').map((r) => r.event)).toEqual(['grading.failed']);
  });
});
