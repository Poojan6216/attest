// @vitest-environment happy-dom
/**
 * src/observers/activity.ts: the coverage ping's user-activity flag. True only while the tab is visible and the
 * user's own input was seen within USER_ACTIVE_WINDOW_MS. Listening is not acting (Hard Rule 3): passive
 * listeners, nothing read from the event but whether it is trusted, no default prevented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isoWithLocalOffset } from '../../../src/clock';
import { USER_ACTIVE_WINDOW_MS, USER_ACTIVITY_THROTTLE_MS } from '../../../src/config';
import { trackUserActivity, USER_INPUT_EVENTS, type UserActivity } from '../../../src/observers/activity';

const now = (): string => isoWithLocalOffset(new Date());
const everyEvent = (): boolean => true;
let tracker: UserActivity | undefined;

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  tracker?.disconnect();
  tracker = undefined;
  vi.useRealTimers();
  setVisibility('visible');
});

describe('constants', () => {
  it('a minute of recent input counts as active, noted at most once a second', () => {
    expect(USER_ACTIVE_WINDOW_MS).toBe(60_000);
    expect(USER_ACTIVITY_THROTTLE_MS).toBe(1_000);
    expect(USER_INPUT_EVENTS).toEqual(['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']);
  });
});

describe('trackUserActivity', () => {
  it('is inactive until the user does something', () => {
    tracker = trackUserActivity(window, { now, isUserInput: everyEvent });
    expect(tracker.active()).toBe(false);
  });

  it.each(USER_INPUT_EVENTS)('%s makes it active, for USER_ACTIVE_WINDOW_MS', (type) => {
    tracker = trackUserActivity(window, { now, isUserInput: everyEvent });
    window.dispatchEvent(new Event(type));
    expect(tracker.active()).toBe(true);
    vi.advanceTimersByTime(USER_ACTIVE_WINDOW_MS);
    expect(tracker.active()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tracker.active()).toBe(false);
  });

  it('a hidden tab is never active', () => {
    tracker = trackUserActivity(window, { now, isUserInput: everyEvent });
    window.dispatchEvent(new Event('keydown'));
    setVisibility('hidden');
    expect(tracker.active()).toBe(false);
  });

  it('by default only trusted events count: a page script cannot pose as the user', () => {
    tracker = trackUserActivity(window, { now });
    const synthetic = new Event('keydown');
    expect(synthetic.isTrusted).not.toBe(true);
    window.dispatchEvent(synthetic);
    expect(tracker.active()).toBe(false);
  });
});

describe('trackUserActivity: listening is not acting', () => {
  it('notes input at most once per throttle period', () => {
    const clock = vi.fn(now);
    tracker = trackUserActivity(window, { now: clock, isUserInput: everyEvent });
    for (let i = 0; i < 50; i += 1) window.dispatchEvent(new Event('pointermove'));
    expect(clock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(USER_ACTIVITY_THROTTLE_MS);
    window.dispatchEvent(new Event('pointermove'));
    expect(clock).toHaveBeenCalledTimes(2);
  });

  it('never prevents the default, and reads only whether the event is trusted', () => {
    const read: PropertyKey[] = [];
    tracker = trackUserActivity(window, {
      now,
      isUserInput: (event) =>
        new Proxy(event, {
          get: (target, key) => {
            read.push(key);
            return Reflect.get(target, key) as unknown;
          },
        }).isTrusted || true,
    });
    const event = new Event('keydown', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(read).toEqual(['isTrusted']);
  });

  it('disconnect clears its throttle timer, so nothing of it is left pending', () => {
    tracker = trackUserActivity(window, { now, isUserInput: everyEvent });
    window.dispatchEvent(new Event('keydown'));
    expect(vi.getTimerCount()).toBe(1);
    tracker.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('after disconnect, input is no longer noted', () => {
    tracker = trackUserActivity(window, { now, isUserInput: everyEvent });
    tracker.disconnect();
    window.dispatchEvent(new Event('keydown'));
    expect(tracker.active()).toBe(false);
  });
});
