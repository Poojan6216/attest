/**
 * The feature flags a person sets (sprint_4 4.9; src/background/flags.ts): `flag.set` stores one in ledger meta (sprint_4
 * close, security review SEC-3) and tells open pages; a failed write is said and logs no value; the router answers it,
 * and only an extension page may send it, for a flag in SETTABLE_FLAGS only. How the flags read is
 * tests/unit/ledger/consent.spec.ts.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type FlagContext, onFlagSet } from '../../../src/background/flags';
import { createHandlers } from '../../../src/background/router';
import { BusMessage, type LedgerTable } from '../../../src/bus/messages';
import { readFlags } from '../../../src/ledger/consent';
import type { LedgerDb } from '../../../src/ledger/db';
import { deleteLedger, getLedger } from '../../../src/ledger/shared';
import { type LogRecord, setLogSink } from '../../../src/log';
import { extensionPage } from '../bus/harness';

let records: LogRecord[];
let restore: () => void;
let announced: (readonly LedgerTable[])[];
let ctx: FlagContext;

beforeEach(() => {
  records = [];
  restore = setLogSink((record) => {
    records.push(record);
  });
  announced = [];
  ctx = {
    db: getLedger,
    notify: (tables) => {
      announced.push(tables);
    },
  };
});

afterEach(async () => {
  restore();
  await deleteLedger();
});

const AUTO_ON = { type: 'flag.set', flag: 'ATTEST_AUTO_CHECK_GMAIL', on: true } as const;

describe('flag.set', () => {
  it('turns the auto-check on and off again in the ledger, and tells open pages', async () => {
    expect(await onFlagSet(AUTO_ON, ctx)).toEqual({ ok: true });
    expect((await readFlags(await getLedger())).ATTEST_AUTO_CHECK_GMAIL).toBe(true);
    expect(await onFlagSet({ ...AUTO_ON, on: false }, ctx)).toEqual({ ok: true });
    expect((await readFlags(await getLedger())).ATTEST_AUTO_CHECK_GMAIL).toBe(false);
    expect(announced).toEqual([['meta'], ['meta']]);
    expect(records.filter(({ event }) => event === 'flags.set').map(({ fields }) => fields)).toEqual([
      { flag: 'ATTEST_AUTO_CHECK_GMAIL', on: true },
      { flag: 'ATTEST_AUTO_CHECK_GMAIL', on: false },
    ]);
  });

  it('says it failed when the choice cannot be stored, tells no page, and logs no value', async () => {
    const broken: FlagContext = {
      db: () => Promise.reject(new Error('QuotaExceededError: the quota has been exceeded')),
      notify: ctx.notify,
    };
    expect(await onFlagSet(AUTO_ON, broken)).toEqual({ ok: false, code: 'failed' });
    expect(records.map(({ event }) => event)).toEqual(['flags.set_failed']);
    expect(announced).toEqual([]);
    expect(JSON.stringify(records)).not.toContain('quota');
  });

  it('is answered by the router, and a flag no page may set never parses', async () => {
    const handler = createHandlers()['flag.set'];
    if (handler === undefined) throw new Error('no flag.set handler');
    expect(await handler(AUTO_ON, extensionPage('/options.html'))).toEqual({ ok: true });
    const db: LedgerDb = await getLedger();
    expect((await readFlags(db)).ATTEST_AUTO_CHECK_GMAIL).toBe(true);
    for (const flag of ['ATTEST_TELEMETRY', 'ATTEST_MODEL', 'ATTEST_DOTS', 'ATTEST_ANYTHING']) {
      expect(BusMessage.safeParse({ ...AUTO_ON, flag }).success).toBe(false);
    }
  });
});
