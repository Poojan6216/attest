/**
 * What the service worker remembers between one observer message and the next (src/background/observer-state.ts;
 * sprint_2 2.7; docs/grading.md §3; Hard Rules 4, 5, 6): one observer's messages run one at a time in arrival order,
 * a Calendar pass's pings are held for that pass's snapshot only and not for ever, and a DEGRADED is cleared only by
 * the observer's own report of the pass that was accepted.
 */
import { describe, expect, it } from 'vitest';

import {
  createPassState,
  holdPing,
  noteOwnHealth,
  ownReportOf,
  serially,
  takeHeld,
} from '../../../src/background/observer-state';
import { CALENDAR_PASS_HOLD_MS } from '../../../src/config';
import { HealthReport } from '../../../src/core/schema';
import { CoveragePing } from '../../../src/ledger/types';
import { ACCOUNT } from './calendar-fixtures';

const T0 = '2026-10-03T12:00:00-04:00';
const T1 = '2026-10-03T12:05:00-04:00';
const T0_MS = Date.parse(T0);
const T1_MS = Date.parse(T1);

function ping(lastSyncAt: string): CoveragePing {
  return CoveragePing.parse({
    observerId: 'gcal.event',
    source: 'gcal.event',
    accountHash: ACCOUNT,
    lastSyncAt,
    windowStart: '2026-10-04T00:00:00-04:00',
    windowEnd: '2026-10-11T00:00:00-04:00',
    allCalendars: true,
    userActive: false,
  });
}

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('serially', () => {
  it('runs the jobs of one observer one at a time, in arrival order; a failed job never blocks the next', async () => {
    const state = createPassState();
    const order: string[] = [];
    const gate = deferred();
    const first = serially(state, 'gmail.sent', async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
      throw new Error('boom');
    });
    const second = serially(state, 'gmail.sent', () => {
      order.push('second');
      return Promise.resolve('done');
    });
    const other = serially(state, 'gcal.event', () => {
      order.push('other observer');
      return Promise.resolve();
    });
    await other;
    expect(order).toEqual(['first:start', 'other observer']);
    gate.resolve();
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('done');
    expect(order).toEqual(['first:start', 'other observer', 'first:end', 'second']);
  });
});

describe('held Calendar pings', () => {
  it('are given only to the snapshot of their own pass, from the same sender', () => {
    const state = createPassState();
    expect(holdPing(state, 'tab-1', ping(T0), T0_MS)).toBe(true);
    expect(takeHeld(state, 'tab-2', 'gcal.event', T0_MS, T0_MS)).toBeUndefined();
    expect(takeHeld(state, 'tab-1', 'gcal.event', T1_MS, T0_MS)).toBeUndefined();
    expect(takeHeld(state, 'tab-1', 'gcal.event', T0_MS, T0_MS)?.pings).toHaveLength(1);
    expect(takeHeld(state, 'tab-1', 'gcal.event', T0_MS, T0_MS)).toBeUndefined();
  });

  it('expire: a pass whose snapshot never came records no coverage', () => {
    const state = createPassState();
    holdPing(state, 'tab-1', ping(T0), T0_MS);
    expect(takeHeld(state, 'tab-1', 'gcal.event', T0_MS, T0_MS + CALENDAR_PASS_HOLD_MS + 1)).toBeUndefined();
  });

  it('a ping of the next pass from the same sender replaces what the last one held', () => {
    const state = createPassState();
    holdPing(state, 'tab-1', ping(T0), T0_MS);
    holdPing(state, 'tab-1', ping(T1), T1_MS);
    expect(takeHeld(state, 'tab-1', 'gcal.event', T0_MS, T1_MS)).toBeUndefined();
    expect(takeHeld(state, 'tab-1', 'gcal.event', T1_MS, T1_MS)?.pings).toEqual([ping(T1)]);
  });
});

describe('ownReportOf', () => {
  it('is the own report of the observer for exactly that pass, never of another one', () => {
    const state = createPassState();
    const report = HealthReport.parse({
      adapterId: 'gmail.sent',
      version: '1.0.0',
      status: 'OK',
      reasons: [],
      checkedAt: T1,
    });
    noteOwnHealth(state, report);
    expect(ownReportOf(state, 'gmail.sent', T1_MS)).toEqual(report);
    expect(ownReportOf(state, 'gmail.sent', T0_MS)).toBeUndefined();
    expect(ownReportOf(state, 'gcal.event', T1_MS)).toBeUndefined();
  });
});
