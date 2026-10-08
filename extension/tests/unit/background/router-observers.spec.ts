/**
 * The service worker's router for the observer messages (src/background/router.ts; sprint_2 2.7). Added by the Sprint 2
 * QA review: router.spec.ts checks only which message types have a handler, so the wiring of each type to its own
 * handler (router.ts lines 67-71) and the `ledger.changed` broadcast (`announce`, lines 41-49) ran in no unit test
 * (router.ts measured 47% of lines). Here each observer message goes through the real bus (src/bus listen() and
 * sendChecked(), over WXT's fake browser with Chrome's sender and JSON wire) to the handlers `createHandlers` wires,
 * and must land in its own table of a real (fake-indexeddb) ledger; and `announce` must broadcast each moved table
 * once, stamped with the clock, and nothing for no table or a clock that gives no instant.
 */
import 'fake-indexeddb/auto';

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { announce, createHandlers } from '../../../src/background/router';
import { listen } from '../../../src/bus/listen';
import { LedgerChangedMessage } from '../../../src/bus/messages';
import { sendChecked } from '../../../src/bus/send';
import { getCalendarRecord } from '../../../src/ledger/calendar-snapshots';
import type { LedgerDb } from '../../../src/ledger/db';
import { openLedger } from '../../../src/ledger/migrations';
import { getAdapterHealth, getObservation } from '../../../src/ledger/repo';
import type { MessageSender } from '../../../src/bus/listen';
import { captureLogs, connectAs, contentScript } from '../bus/harness';
import { makeObservation, makePing, pinClock, releaseClock, uniqueDbName } from '../ledger/fixtures';
import { ACCOUNT, at, event, RANGE, week } from './calendar-fixtures';
import { contextOf, HANDLER_NOW, healthOf, pingOf, rowsOf, snapshotOf } from './observer-harness';

let db: LedgerDb;
let stop: () => void = () => undefined;

beforeEach(async () => {
  fakeBrowser.reset();
  pinClock();
  db = await openLedger(uniqueDbName('router-observers'));
});

afterEach(() => {
  stop();
  db.close();
  releaseClock();
});

const clock = () => HANDLER_NOW;

/** A content script's sender whose page can be moved between sites, as Chrome would set it per message. */
function movableSender(): { readonly sender: MessageSender; readonly on: (url: string) => void } {
  const sender: MessageSender = { ...contentScript(), tab: { id: 7 } as NonNullable<MessageSender['tab']> };
  return {
    sender,
    on: (url) => {
      Object.assign(sender, { url });
    },
  };
}

const GMAIL_PAGE = 'https://mail.google.com/mail/u/0/#sent';
const CALENDAR_PAGE = 'https://calendar.google.com/calendar/u/0/r/week';

describe('createHandlers routes each observer message to its own handler', () => {
  it('health, rows, a Gmail ping and a Calendar snapshot each reach the ledger table they belong to', async () => {
    const page = movableSender();
    connectAs(page.sender);
    stop = listen(createHandlers(clock, contextOf(db)));
    page.on(GMAIL_PAGE);
    const SIGHTED = '2026-10-01T10:20:00-04:00';
    const row = makeObservation({ observedAt: SIGHTED });
    expect(await sendChecked(healthOf('gmail.sent', SIGHTED))).toEqual({ ok: true });
    expect(await sendChecked(rowsOf('gmail.sent', [row]))).toEqual({ ok: true });
    const ping = makePing({
      observerId: 'gmail.sent',
      lastSyncAt: SIGHTED,
      windowStart: '2026-10-01T09:00:00-04:00',
      windowEnd: SIGHTED,
    });
    expect(await sendChecked(pingOf(ping))).toEqual({ ok: true });
    page.on(CALENDAR_PAGE);
    expect(await sendChecked(snapshotOf(week([event('a')], { readAt: at(0) }), ACCOUNT))).toEqual({
      ok: true,
    });

    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'OK', checkedAt: SIGHTED });
    expect(await getObservation(db, row.id)).toEqual(row);
    const intervals = await db.coverageIntervals.toArray();
    expect(intervals.filter((each) => each.source === 'gmail.sent')).toHaveLength(1);
    const record = await getCalendarRecord(db, {
      observerId: 'gcal.event',
      accountHash: ACCOUNT,
      range: RANGE,
    });
    expect(record?.snapshot.readAt).toBe(at(0));
  });

  it('a message of one type never reaches another type’s handler: a forged ping is refused, nothing stored', async () => {
    connectAs(contentScript());
    stop = listen(createHandlers(clock, contextOf(db)));
    // A Gmail Sent window that ends before its sync: only the ping handler knows to refuse it (interface 3).
    const ping = makePing({
      observerId: 'gmail.sent',
      lastSyncAt: '2026-10-01T10:20:00-04:00',
      windowStart: '2026-10-01T09:00:00-04:00',
      windowEnd: '2026-10-01T10:00:00-04:00',
    });
    expect(await sendChecked(pingOf(ping))).toEqual({ ok: false, code: 'invalid_input' });
    expect(await db.coverageIntervals.count()).toBe(0);
    expect(await getAdapterHealth(db, 'gmail.sent')).toMatchObject({ status: 'DEGRADED' });
  });
});

const SIGHTED = '2026-10-01T10:20:00-04:00';
const refused = { ok: false, code: 'invalid_input' };

async function nothingStored(): Promise<void> {
  expect(await db.observations.count()).toBe(0);
  expect(await db.coverageIntervals.count()).toBe(0);
  expect(await db.coverage.count()).toBe(0);
  expect(await db.calendarSnapshots.count()).toBe(0);
  expect(await db.adapterHealth.count()).toBe(0);
}

const gmailPing = makePing({
  observerId: 'gmail.sent',
  lastSyncAt: SIGHTED,
  windowStart: '2026-10-01T09:00:00-04:00',
  windowEnd: SIGHTED,
});
const calendarPing = makePing({
  observerId: 'gcal.event',
  source: 'gcal.event',
  lastSyncAt: SIGHTED,
  windowStart: '2026-10-04T00:00:00-04:00',
  windowEnd: '2026-10-11T00:00:00-04:00',
});
const calendarRow = makeObservation({
  source: 'gcal.event',
  type: 'calendar.created',
  counterparty: undefined,
  subjectHint: 'Design review',
  occurredAt: '2026-10-08T13:00:00-04:00',
  observedAt: SIGHTED,
});

describe('SEC-V1: an observer message is taken only from a page on that observer’s own site', () => {
  const logs = captureLogs();
  it('a Gmail tab posting gcal.event health, rows, a ping or a snapshot is refused, and nothing is stored', async () => {
    const page = movableSender();
    connectAs(page.sender);
    stop = listen(createHandlers(clock, contextOf(db)));
    page.on(GMAIL_PAGE);
    expect(await sendChecked(healthOf('gcal.event', SIGHTED))).toEqual(refused);
    expect(await sendChecked(rowsOf('gcal.event', [calendarRow]))).toEqual(refused);
    expect(await sendChecked(pingOf(calendarPing))).toEqual(refused);
    expect(await sendChecked(snapshotOf(week([event('a')], { readAt: at(0) }), ACCOUNT))).toEqual(refused);
    await nothingStored();
    const wrong = logs.filter((record) => record.event === 'observer.wrong_site');
    expect(wrong.map((record) => record.fields)).toEqual([
      { observer: 'gcal.event', type: 'adapter.health' },
      { observer: 'gcal.event', type: 'observer.observations' },
      { observer: 'gcal.event', type: 'coverage.ping' },
      { observer: 'gcal.event', type: 'calendar.snapshot' },
    ]);
  });

  it('a Calendar tab posting gmail.sent health, rows or a ping is refused, and nothing is stored', async () => {
    const page = movableSender();
    connectAs(page.sender);
    stop = listen(createHandlers(clock, contextOf(db)));
    page.on(CALENDAR_PAGE);
    expect(await sendChecked(healthOf('gmail.sent', SIGHTED))).toEqual(refused);
    expect(await sendChecked(rowsOf('gmail.sent', [makeObservation({ observedAt: SIGHTED })]))).toEqual(
      refused,
    );
    expect(await sendChecked(pingOf(gmailPing))).toEqual(refused);
    // A snapshot naming a Gmail observer from a Calendar page: the site check refuses it before the Calendar handler.
    const forged = snapshotOf(week([event('a')], { readAt: at(0) }), ACCOUNT, 'gmail.sent');
    expect(await sendChecked(forged)).toEqual(refused);
    await nothingStored();
    const wrong = logs.filter((record) => record.event === 'observer.wrong_site');
    expect(wrong.map((record) => record.fields.type)).toEqual([
      'adapter.health',
      'observer.observations',
      'coverage.ping',
      'calendar.snapshot',
    ]);
  });
});

describe('SEC-V1: a sender speaks only for the observers of the site Chrome says it is on', () => {
  it('an observer the extension does not have, or a page with no usable address, speaks for nobody', async () => {
    const page = movableSender();
    connectAs(page.sender);
    stop = listen(createHandlers(clock, contextOf(db)));
    page.on(GMAIL_PAGE);
    expect(await sendChecked(healthOf('muse', SIGHTED))).toEqual(refused);
    for (const url of ['https://mail.google.com.evil.example/', 'http://mail.google.com/', 'not a url']) {
      page.on(url);
      expect(await sendChecked(healthOf('gmail.sent', SIGHTED))).toEqual(refused);
    }
    // A sender whose origin, as Chrome states it, is not its page's: neither is trusted.
    page.on(GMAIL_PAGE);
    Object.assign(page.sender, { origin: 'https://evil.example' });
    expect(await sendChecked(healthOf('gmail.sent', SIGHTED))).toEqual(refused);
    Object.assign(page.sender, { origin: 'https://mail.google.com' });
    expect(await sendChecked(healthOf('gmail.sent', SIGHTED))).toEqual({ ok: true });
    await db.adapterHealth.clear();
    await nothingStored();
  });
});

const MUSE_PAGE = 'https://muse.ai/thread/new';

describe('an agent adapter’s health is taken only from a page on its agent’s site (sprint_3 3.2)', () => {
  const logs = captureLogs();
  it('Muse’s health from a muse.ai page is stored; from a Gmail page it is refused; a Muse page speaks for no observer', async () => {
    const page = movableSender();
    connectAs(page.sender);
    stop = listen(createHandlers(clock, contextOf(db)));
    page.on(GMAIL_PAGE);
    expect(await sendChecked(healthOf('muse.chat', SIGHTED))).toEqual(refused);
    page.on(MUSE_PAGE);
    expect(await sendChecked(healthOf('gmail.sent', SIGHTED))).toEqual(refused);
    await nothingStored();
    expect(await sendChecked(healthOf('muse.chat', SIGHTED))).toEqual({ ok: true });
    expect(await getAdapterHealth(db, 'muse.chat')).toMatchObject({ adapterId: 'muse.chat', status: 'OK' });
    expect(logs.filter((record) => record.event === 'observer.wrong_site').map((r) => r.fields)).toEqual([
      { observer: 'muse.chat', type: 'adapter.health' },
      { observer: 'gmail.sent', type: 'adapter.health' },
    ]);
  });
});

/** Every `ledger.changed` the fake browser delivered while `act` ran. */
async function broadcasts(act: () => void): Promise<unknown[]> {
  const seen: unknown[] = [];
  fakeBrowser.runtime.onMessage.addListener((message: unknown) => {
    seen.push(message);
  });
  act();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return seen;
}

describe('announce: the ledger.changed broadcast', () => {
  it('names each moved table once, stamped with the clock', async () => {
    const seen = await broadcasts(() => {
      announce(clock)(['observations', 'coverageIntervals', 'observations']);
    });
    expect(seen).toEqual([
      LedgerChangedMessage.parse({
        type: 'ledger.changed',
        tables: ['observations', 'coverageIntervals'],
        at: HANDLER_NOW,
      }),
    ]);
  });

  it('sends nothing for no table, or when the clock gives no instant', async () => {
    const seen = await broadcasts(() => {
      announce(clock)([]);
      announce(() => 'not a time')(['observations']);
    });
    expect(seen).toEqual([]);
  });
});
