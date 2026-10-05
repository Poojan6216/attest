/**
 * The Calendar content script's observer and post (entrypoints/content/gcal.content.ts `calendarScript`; sprint_2
 * 2.7; Decisions [2.7]): on a page whose account is known a pass posts no rows of its own (the service worker
 * derives them from the snapshot), and its snapshot carries the hash of the account that same pass read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { calendarScript } from '../../../entrypoints/content/gcal.content';
import { listen } from '../../../src/bus/listen';
import { ACK_OK, type BusMessage } from '../../../src/bus/messages';
import { IsoTs } from '../../../src/core/schema';
import { accountHashOf } from '../../../src/observers/account';
import type { GcalObserver } from '../../../src/observers/gcal/observer';
import type { ExtractContext, RawRow } from '../../../src/observers/types';
import { connectAs, contentScript, SNAPSHOT, TS_OFFSET, VALID } from './harness';

const ROW: RawRow = { type: 'calendar.created', rowKey: 'ab'.repeat(32), fields: { occurredAt: TS_OFFSET } };
const DOC = {} as Document;
const ctxAt = (observedAt: string): ExtractContext => ({
  observedAt: IsoTs.parse(observedAt),
  offsetAt: () => -240,
});

/** A stand-in Calendar observer: its account and rows are the test's. */
function calendarWith(account: string | null): GcalObserver {
  return {
    id: 'gcal.event',
    vendor: 'gcal',
    version: '1.2.0',
    hosts: ['https://calendar.google.com/*'],
    source: 'gcal.event',
    health: () => ({ status: 'OK' }),
    extract: () => [ROW],
    account: () => account,
    visibleWindows: () => [],
    range: () => SNAPSHOT.range,
    snapshot: () => SNAPSHOT,
    allCalendars: () => false,
  };
}

let received: BusMessage[] = [];

beforeEach(() => {
  fakeBrowser.reset();
  received = [];
  connectAs(contentScript());
  const store = (message: BusMessage) => {
    received.push(message);
    return Promise.resolve(ACK_OK);
  };
  listen({ 'calendar.snapshot': store, 'coverage.ping': store, 'adapter.health': store });
});

const snapshotMessage = () => ({
  type: 'calendar.snapshot' as const,
  observerId: 'gcal.event',
  snapshot: SNAPSHOT,
});

describe('calendarScript', () => {
  it('with a known account: no rows of its own, and the snapshot of that pass names the account hash', async () => {
    const { observer, post } = calendarScript(calendarWith('Avery.Founder@example.com'));
    expect(observer.extract(DOC, ctxAt(SNAPSHOT.readAt))).toEqual([]);
    await post(snapshotMessage());
    expect(received).toEqual([
      { ...snapshotMessage(), accountHash: accountHashOf('avery.founder@example.com') },
    ]);
  });

  it('a snapshot of another pass than the last one read is posted without an account', async () => {
    const { observer, post } = calendarScript(calendarWith('avery.founder@example.com'));
    observer.extract(DOC, ctxAt('2026-10-03T09:00:00-04:00'));
    await post(snapshotMessage());
    expect(received).toEqual([snapshotMessage()]);
  });

  it('with no account: the observer rows are posted as first sightings, and no snapshot names an account', async () => {
    const { observer, post } = calendarScript(calendarWith(null));
    expect(observer.extract(DOC, ctxAt(SNAPSHOT.readAt))).toEqual([ROW]);
    await post(snapshotMessage());
    expect(received).toEqual([snapshotMessage()]);
  });

  it('every other message goes out as the skeleton built it', async () => {
    const { post } = calendarScript(calendarWith('avery.founder@example.com'));
    await post(VALID['coverage.ping']);
    expect(received).toEqual([VALID['coverage.ping']]);
  });

  it('a message the service worker never stores rejects the post, so the pass stops', async () => {
    const { post } = calendarScript(calendarWith('avery.founder@example.com'));
    await expect(post(VALID['observer.observations'])).rejects.toMatchObject({ name: 'BusError' });
  });
});
