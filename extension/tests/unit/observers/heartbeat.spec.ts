// @vitest-environment happy-dom
/**
 * src/observers/base.ts startObserver `heartbeatMs` (sprint_2 2.7 wave E follow-up; docs/grading.md §3, §7): a visible
 * page is read again every heartbeat even when nothing in it changed, and as soon as it becomes visible again; a
 * hidden page is not read on a beat; disconnect stops the beats; an invalid heartbeat is refused before anything is
 * attached. The Calendar content script runs with OBSERVER_HEARTBEAT_MS, and that heartbeat (plus the longest batch
 * wait) stays inside the attribution bound the service worker uses, so a change seen in a quiet visible tab can still
 * be attributed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { staleChangeMs } from '../../../src/background/calendar-step';
import type { BusMessage } from '../../../src/bus/messages';
import { isoWithLocalOffset } from '../../../src/clock';
import { OBSERVER_DEBOUNCE_MS, OBSERVER_HEARTBEAT_MS, OBSERVER_MAX_WAIT_MS } from '../../../src/config';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { type ObserverHandle, startObserver } from '../../../src/observers/base';
import { ObserverError } from '../../../src/observers/errors';
import { pageHtml, recordingPost, sentObserver } from './helpers';

let handle: ObserverHandle | undefined;
let visibility: DocumentVisibilityState = 'visible';
const now = (): string => isoWithLocalOffset(new Date());
const HEARTBEAT = 60_000;

/** How many passes posted their health report (every pass posts one). */
const passes = (messages: readonly BusMessage[]): number =>
  messages.filter((m) => m.type === 'adapter.health').length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T18:30:00Z'));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const parsed = new DOMParser().parseFromString(pageHtml(), 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
});

afterEach(() => {
  handle?.disconnect();
  handle = undefined;
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
});

async function startedWith(heartbeatMs: number | null): Promise<ReturnType<typeof recordingPost>> {
  const recording = recordingPost();
  handle = startObserver(sentObserver(), { post: recording.post, now, heartbeatMs });
  await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
  await handle.settled();
  return recording;
}

describe('startObserver: heartbeat', () => {
  it('reads a quiet visible page again every heartbeat, and never without one', async () => {
    const beating = await startedWith(HEARTBEAT);
    expect(passes(beating.messages)).toBe(1);
    await vi.advanceTimersByTimeAsync(HEARTBEAT + OBSERVER_MAX_WAIT_MS);
    await handle?.settled();
    expect(passes(beating.messages)).toBe(2);
    await vi.advanceTimersByTimeAsync(HEARTBEAT);
    await handle?.settled();
    expect(passes(beating.messages)).toBe(3);
    handle?.disconnect();
    const quiet = await startedWith(null);
    await vi.advanceTimersByTimeAsync(HEARTBEAT * 3);
    await handle?.settled();
    expect(passes(quiet.messages)).toBe(1);
  });

  it('does not read a hidden page on a beat, and reads it as soon as it becomes visible', async () => {
    const recording = await startedWith(HEARTBEAT);
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(HEARTBEAT * 3);
    await handle?.settled();
    expect(passes(recording.messages)).toBe(1);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS);
    await handle?.settled();
    expect(passes(recording.messages)).toBe(2);
  });

  it('disconnect stops the beats and removes the visibility listener', async () => {
    const removed = vi.spyOn(document, 'removeEventListener');
    const recording = await startedWith(HEARTBEAT);
    handle?.disconnect();
    expect(removed.mock.calls.map(([type]) => type)).toContain('visibilitychange');
    await vi.advanceTimersByTimeAsync(HEARTBEAT * 3);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS);
    expect(passes(recording.messages)).toBe(1);
  });

  it.each([0, -1, 1.5, OBSERVER_MAX_WAIT_MS - 1, Number.NaN])(
    'refuses heartbeat %s before attaching anything',
    (heartbeatMs) => {
      const added = vi.spyOn(document, 'addEventListener');
      expect(() => startObserver(sentObserver(), { post: recordingPost().post, now, heartbeatMs })).toThrow(
        new ObserverError('invalid_options'),
      );
      expect(added).not.toHaveBeenCalled();
    },
  );
});

describe('the Calendar heartbeat keeps changes attributable', () => {
  it('a snapshot a change is compared with is never older than the attribution bound', () => {
    expect(OBSERVER_HEARTBEAT_MS + OBSERVER_MAX_WAIT_MS).toBeLessThan(staleChangeMs(DEFAULT_POLICY));
  });
});
