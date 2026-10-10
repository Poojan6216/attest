import 'fake-indexeddb/auto';
/**
 * The service worker's `grant.save` handler (sprint_4 4.4; src/background/grant-save.ts, src/ledger/grant-save.ts): the
 * person's choices are stored as the agent's grant, with what Attest observed kept from the stored one and `updatedAt`
 * stamped after the last batch, and the agent's alert mute beside it, announced and logged by agent only; then a batch
 * regrades the agent's open (PENDING) receipts under it. A tighter grant turns an open claim OVER_SCOPE, and a FINAL
 * receipt is never changed: a grant changes what comes, never what was decided. A save is a stored fact, so the batch
 * after it grades even with nothing PENDING: a narrower declared access adds its scope receipt at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readPastedLog } from '../../../src/adapters/paste';
import { type ImportContext, onClaimsImport } from '../../../src/background/claims-import';
import { onGrantSave } from '../../../src/background/grant-save';
import { runGradingBatch } from '../../../src/background/grading';
import { ClaimsImportMessage, GrantSaveMessage } from '../../../src/bus/messages';
import { DEFAULT_POLICY, DEFAULT_POLICY_DOCUMENT } from '../../../src/core/policy';
import { type Grant, IsoTs, Receipt } from '../../../src/core/schema';
import { lastBatchMs } from '../../../src/ledger/batch-instant';
import { readRows, type LedgerDb } from '../../../src/ledger/db';
import { alertsMutedKey } from '../../../src/ledger/meta-keys';
import { openLedger } from '../../../src/ledger/migrations';
import { getGrant, getMeta, putGrant } from '../../../src/ledger/repo';
import { type LogRecord, setLogSink } from '../../../src/log';
import { makeGrant, pinClock, releaseClock, sha, uniqueDbName } from '../ledger/fixtures';

const PASTED_AT = '2026-10-08T17:00:00-04:00';
/** An email two days old (its wait for coverage over: FINAL) and one half an hour old (still checking: PENDING). */
const LOG = [
  'Oct 6',
  'Sent an email to sam@example.com',
  '2:02 pm',
  'Today',
  'Sent an email to ana@example.com',
  '4:30 pm',
];

let db: LedgerDb;
let ctx: ImportContext;
let notify: ReturnType<typeof vi.fn<ImportContext['notify']>>;
let records: LogRecord[];
let restore: () => void;

beforeEach(async () => {
  pinClock(PASTED_AT);
  db = await openLedger(uniqueDbName('grant-save'));
  notify = vi.fn<ImportContext['notify']>();
  ctx = {
    db: () => Promise.resolve(db),
    grading: { policy: DEFAULT_POLICY, policyDocument: DEFAULT_POLICY_DOCUMENT, nowMs: () => Date.now() },
    notify,
  };
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

async function imported(): Promise<void> {
  const read = readPastedLog(LOG.join('\n'), {
    agent: 'muse',
    pastedAt: IsoTs.parse(PASTED_AT),
    offsetAt: () => -240,
  });
  if (!read.ok) throw new Error(read.refusal);
  const message = ClaimsImportMessage.parse({
    type: 'claims.import',
    agent: 'muse',
    claims: read.log.claims,
    activeAt: [],
  });
  expect(await onClaimsImport(ctx, message)).toMatchObject({ ok: true, added: 2 });
}

const receipts = async () => readRows('receipts', Receipt, await db.receipts.toArray());

/** What a person chooses in `grant`: its declared fields, never what Attest observed nor its stamp. */
const choicesOf = ({
  agent,
  allowedTypes,
  counterpartyAllowlist,
  spendCeilingCents,
  declaredScopes,
}: Grant) => ({
  agent,
  allowedTypes,
  counterpartyAllowlist,
  spendCeilingCents,
  declaredScopes,
});

const saveOf = (grant: ReturnType<typeof choicesOf>, alertsMuted = false) =>
  GrantSaveMessage.parse({ type: 'grant.save', grant, alertsMuted });

describe('grant.save', () => {
  it('regrades the open receipt under a tighter grant, and never touches the FINAL one', async () => {
    await imported();
    const before = await receipts();
    const final = before.find(({ state }) => state === 'FINAL');
    const open = before.find(({ state }) => state === 'PENDING');
    expect(final).toBeDefined();
    expect(open).toBeDefined();
    pinClock('2026-10-08T17:05:00-04:00');
    const held = await getGrant(db, 'muse');
    if (held === undefined) throw new Error('no default grant');
    const tighter = saveOf({ ...choicesOf(held), allowedTypes: ['calendar.created'] }, true);
    await expect(onGrantSave(ctx, tighter)).resolves.toEqual({ ok: true });
    const after = await receipts();
    expect(after.find(({ id }) => id === final?.id)).toEqual(final);
    const regraded = after.find(({ id }) => id === open?.id);
    expect(regraded).toMatchObject({ grade: 'OVER_SCOPE' });
    expect(regraded?.reasons.map(({ code }) => code)).toContain('scope.type_not_allowed');
  });

  it('stamps the grant after the last batch, keeps the mute beside it, announces and logs the agent only', async () => {
    await imported();
    const lastMs = (await lastBatchMs(db)) ?? 0;
    // The clock reads a minute before that batch: the grant is still stamped after it.
    pinClock(new Date(lastMs - 60_000).toISOString());
    const held = await getGrant(db, 'muse');
    if (held === undefined) throw new Error('no default grant');
    notify.mockClear();
    await onGrantSave(ctx, saveOf(choicesOf(held), true));
    expect(Date.parse((await getGrant(db, 'muse'))?.updatedAt ?? '')).toBe(lastMs + 1);
    expect(await getMeta(db, alertsMutedKey('muse'))).toBe(true);
    expect(notify.mock.calls[0]).toEqual([['grants', 'meta']]);
    expect(records.filter(({ event }) => event === 'grant.saved').map(({ fields }) => fields)).toEqual([
      { agent: 'muse' },
    ]);
  });
});

describe('grant.save: the advisory model', () => {
  it('asks the model after its batch, and answers without waiting for it (sprint_5 5.4)', async () => {
    await imported();
    const askModel = vi.fn(() => new Promise<number>(() => undefined));
    const held = await getGrant(db, 'muse');
    if (held === undefined) throw new Error('no default grant');
    pinClock('2026-10-08T17:05:00-04:00');
    expect(await onGrantSave({ ...ctx, askModel }, saveOf(choicesOf(held), false))).toEqual({ ok: true });
    expect(askModel.mock.calls).toEqual([[db]]);
  });
});

describe('grant.save: what Attest observed', () => {
  it('keeps what Attest observed, and grades at once with nothing PENDING: a narrower access adds its scope receipt', async () => {
    const accounts = { 'gmail.sent': [sha(7)] };
    await putGrant(
      db,
      makeGrant({ declaredScopes: ['gmail.read'], observedScopes: ['gmail.read'], accounts }),
    );
    // A batch with nothing to grade: no claim, and the one observed scope is declared.
    await runGradingBatch(db, ctx.grading);
    expect(await receipts()).toEqual([]);
    pinClock('2026-10-08T17:05:00-04:00');
    const held = await getGrant(db, 'muse');
    if (held === undefined) throw new Error('no grant');
    await onGrantSave(ctx, saveOf({ ...choicesOf(held), declaredScopes: [] }));
    expect(await getGrant(db, 'muse')).toMatchObject({
      declaredScopes: [],
      observedScopes: ['gmail.read'],
      accounts,
    });
    expect((await receipts()).map(({ grade, state, reasons }) => [grade, state, reasons[0]?.code])).toEqual([
      ['OVER_SCOPE', 'FINAL', 'scope.observed_not_declared'],
    ]);
    // The page never sends what Attest observed, nor a stamp: the message refuses either.
    const sent = { type: 'grant.save', alertsMuted: false };
    expect(
      GrantSaveMessage.safeParse({ ...sent, grant: { ...choicesOf(held), observedScopes: [] } }).success,
    ).toBe(false);
    expect(GrantSaveMessage.safeParse({ ...sent, grant: held }).success).toBe(false);
  });
});
