// @vitest-environment happy-dom
/**
 * src/observers/lifecycle.ts `trackPageSync` (Decisions [2.close] S4, QA-V2; Hard Rule 5): a read vouches that the
 * page shows the present only while the page says it is online and has not just come back. After an `online` event,
 * a `resume`, a long hidden spell or a sleep (a gap in the page's own tick), each observer's first pass and every pass
 * within PAGE_RESYNC_MS do not vouch, and a pass is requested when that time is up. A tab Chrome only throttles never
 * looks asleep, and a short hidden spell changes nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isoWithLocalOffset } from '../../../src/clock';
import { PAGE_RESYNC_HIDDEN_MS, PAGE_RESYNC_MS, PAGE_SLEEP_GAP_MS, PAGE_TICK_MS } from '../../../src/config';
import { type PageSync, trackPageSync } from '../../../src/observers/lifecycle';

const now = (): string => isoWithLocalOffset(new Date());
let online = true;
let visibility: DocumentVisibilityState = 'visible';
let sync: PageSync | undefined;
const requested = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T18:30:00Z'));
  online = true;
  visibility = 'visible';
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  requested.mockReset();
});

afterEach(() => {
  sync?.disconnect();
  sync = undefined;
  Reflect.deleteProperty(navigator, 'onLine');
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
});

function start(): PageSync {
  sync = trackPageSync(window, { now, timers: { setTimeout, clearTimeout }, requestPass: requested });
  return sync;
}

/** Whether `observer`'s pass at the current (fake) instant vouches. */
const passNow = (tracker: PageSync, observer = 'gmail.sent'): boolean =>
  tracker.vouches(observer, Date.now());

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('a page that never went away', () => {
  it('vouches at every pass while online', () => {
    const tracker = start();
    expect(passNow(tracker)).toBe(true);
    vi.advanceTimersByTime(PAGE_SLEEP_GAP_MS * 3);
    expect(passNow(tracker)).toBe(true);
    expect(passNow(tracker, 'gmail.receipt')).toBe(true);
    expect(requested).not.toHaveBeenCalled();
  });

  it('never vouches while it reports itself offline', () => {
    const tracker = start();
    online = false;
    expect(passNow(tracker)).toBe(false);
    vi.advanceTimersByTime(PAGE_RESYNC_MS * 4);
    expect(passNow(tracker)).toBe(false);
  });
});

describe('a page that comes back', () => {
  it.each([
    ['online', window],
    ['resume', document],
  ] as const)(
    'after %s: each observer’s first pass and every pass within PAGE_RESYNC_MS do not vouch',
    (type, target) => {
      const tracker = start();
      online = type !== 'online';
      if (type === 'online') expect(passNow(tracker)).toBe(false);
      online = true;
      target.dispatchEvent(new Event(type));
      expect(passNow(tracker)).toBe(false);
      vi.advanceTimersByTime(PAGE_RESYNC_MS - 1);
      expect(passNow(tracker)).toBe(false);
      expect(requested).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(requested).toHaveBeenCalledTimes(1);
      expect(passNow(tracker)).toBe(true);
      // Another observer's first pass since the page came back still does not vouch; its next one does.
      expect(passNow(tracker, 'gmail.receipt')).toBe(false);
      expect(passNow(tracker, 'gmail.receipt')).toBe(true);
    },
  );

  it('a first pass that only comes after the wait asks for one more pass, which vouches', () => {
    const tracker = start();
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(PAGE_RESYNC_MS);
    requested.mockReset();
    expect(passNow(tracker)).toBe(false);
    expect(requested).toHaveBeenCalledTimes(1);
    expect(passNow(tracker)).toBe(true);
    expect(requested).toHaveBeenCalledTimes(1);
  });
});

describe('a page that comes back without saying so, or after a long hidden spell', () => {
  it('back online with no online event reaching the page: the first pass online is a comeback', () => {
    const tracker = start();
    online = false;
    expect(passNow(tracker)).toBe(false);
    online = true;
    expect(passNow(tracker)).toBe(false);
    vi.advanceTimersByTime(PAGE_RESYNC_MS);
    expect(passNow(tracker)).toBe(true);
  });

  it('shown again after PAGE_RESYNC_HIDDEN_MS hidden; a shorter hidden spell changes nothing', () => {
    const tracker = start();
    setVisibility('hidden');
    vi.advanceTimersByTime(PAGE_RESYNC_HIDDEN_MS - 1);
    setVisibility('visible');
    expect(passNow(tracker)).toBe(true);
    setVisibility('hidden');
    vi.advanceTimersByTime(PAGE_RESYNC_HIDDEN_MS);
    setVisibility('visible');
    expect(passNow(tracker)).toBe(false);
    vi.advanceTimersByTime(PAGE_RESYNC_MS);
    expect(passNow(tracker)).toBe(true);
  });

  it('a page that loads hidden counts its hidden time from the start', () => {
    visibility = 'hidden';
    const tracker = start();
    vi.advanceTimersByTime(PAGE_RESYNC_HIDDEN_MS);
    setVisibility('visible');
    expect(passNow(tracker)).toBe(false);
  });
});

describe('a machine that slept (no event reaches a sleeping page)', () => {
  it('a pass after a gap of PAGE_SLEEP_GAP_MS in the page’s own tick does not vouch', () => {
    const tracker = start();
    vi.advanceTimersByTime(PAGE_TICK_MS * 2);
    expect(passNow(tracker)).toBe(true);
    // Asleep: the clock moves on and no timer runs.
    vi.setSystemTime(Date.now() + PAGE_SLEEP_GAP_MS);
    expect(passNow(tracker)).toBe(false);
    vi.advanceTimersByTime(PAGE_RESYNC_MS);
    expect(passNow(tracker)).toBe(true);
  });

  it('the overdue tick that runs on waking marks the comeback before any pass', () => {
    const tracker = start();
    vi.setSystemTime(Date.now() + PAGE_SLEEP_GAP_MS + PAGE_TICK_MS);
    vi.advanceTimersByTime(PAGE_TICK_MS);
    expect(passNow(tracker)).toBe(false);
  });

  it('a hidden tab whose timers Chrome wakes once a minute never looks asleep', () => {
    const tracker = start();
    for (let minute = 0; minute < 30; minute += 1) {
      vi.setSystemTime(Date.now() + 60_000 - PAGE_TICK_MS);
      vi.advanceTimersByTime(PAGE_TICK_MS);
    }
    expect(passNow(tracker)).toBe(true);
  });
});

describe('listening is not acting (Hard Rule 3)', () => {
  it('disconnect removes every listener with the options it was added with, and every timer', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const docAdded = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const docRemoved = vi.spyOn(document, 'removeEventListener');
    const tracker = start();
    window.dispatchEvent(new Event('online'));
    for (const [, , options] of [...added.mock.calls, ...docAdded.mock.calls]) {
      expect(options).toEqual({ capture: true, passive: true });
    }
    tracker.disconnect();
    sync = undefined;
    expect(removed.mock.calls).toEqual(added.mock.calls);
    expect(docRemoved.mock.calls).toEqual(docAdded.mock.calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
