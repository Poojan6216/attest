/**
 * Keeping the service worker running while the ledger is unlocked (src/background/keep-awake.ts; sprint_6 6.5): a ping
 * every KEEP_AWAKE_MS, under Chrome's 30-second idle stop, one timer however often it is asked for, none once the worker
 * may sleep again, and a ping that fails logged, never thrown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keepAwake, keptAwake, letSleep } from '../../../src/background/keep-awake';
import { KEEP_AWAKE_MS } from '../../../src/config-crypto';
import { captureLogs } from '../bus/harness';

const records = captureLogs();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  letSleep();
  vi.useRealTimers();
});

describe('keepAwake', () => {
  it('pings under the 30-second idle stop, once per period, from one timer however often asked', () => {
    expect(KEEP_AWAKE_MS).toBeLessThan(30_000);
    const ping = vi.fn(() => Promise.resolve());
    keepAwake(ping);
    keepAwake(ping);
    expect(keptAwake()).toBe(true);
    vi.advanceTimersByTime(KEEP_AWAKE_MS * 3);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it('stops pinging once the worker may sleep', () => {
    const ping = vi.fn(() => Promise.resolve());
    keepAwake(ping);
    vi.advanceTimersByTime(KEEP_AWAKE_MS);
    letSleep();
    expect(keptAwake()).toBe(false);
    vi.advanceTimersByTime(KEEP_AWAKE_MS * 5);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('logs a ping that fails, and keeps pinging', async () => {
    const ping = vi.fn(() => Promise.reject(new Error('no runtime')));
    keepAwake(ping);
    await vi.advanceTimersByTimeAsync(KEEP_AWAKE_MS * 2);
    expect(ping).toHaveBeenCalledTimes(2);
    expect(records.filter((record) => record.event === 'crypto.keep_awake_failed')).toHaveLength(2);
  });
});
