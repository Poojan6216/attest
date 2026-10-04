// @vitest-environment happy-dom
/**
 * src/observers/base.ts startObserver (sprint_2 2.0): the skeleton on a live (happy-dom) page, with fake timers.
 * The first pass posts a coverage ping one debounce after start (well within the Done-when's 1 s); a burst of
 * mutations makes one more pass; passes never overlap; disconnect stops everything; and through the real bus
 * (`send` → `listen`, WXT's fake browser) the service worker receives exactly the messages the schemas allow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

import { listen } from '../../../src/bus/listen';
import type { BusMessage } from '../../../src/bus/messages';
import { isoWithLocalOffset } from '../../../src/clock';
import { OBSERVER_DEBOUNCE_MS, OBSERVER_MAX_WAIT_MS } from '../../../src/config';
import { type ObserverHandle, startObserver } from '../../../src/observers/base';
import { ObserverError } from '../../../src/observers/errors';
import { connectAs, contentScript } from '../bus/harness';
import { leaks, pageHtml, recordingPost, sentObserver } from './helpers';

let handle: ObserverHandle | undefined;
const now = (): string => isoWithLocalOffset(new Date());

function loadPage(options: Parameters<typeof pageHtml>[0] = {}): void {
  const parsed = new DOMParser().parseFromString(pageHtml(options), 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

function appendRow(): void {
  const row = document.querySelector('[role="row"]')?.cloneNode(true);
  if (!(row instanceof Element)) throw new Error('no row to copy');
  row.setAttribute('data-row-key', `r${String(document.querySelectorAll('[role="row"]').length + 1)}`);
  document.querySelector('[role="grid"]')?.append(row);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T18:30:00Z'));
  loadPage();
});

afterEach(() => {
  handle?.disconnect();
  handle = undefined;
  vi.useRealTimers();
});

const types = (messages: readonly BusMessage[]): string[] => messages.map((m) => m.type);

describe('startObserver', () => {
  it('posts a coverage ping one debounce after start, under the 1 s Done-when', async () => {
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS - 1);
    expect(recording.messages).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await handle.settled();
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    expect(OBSERVER_DEBOUNCE_MS).toBeLessThan(1_000);
  });

  it('a burst of mutations makes one more pass; a quiet page makes none', async () => {
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    await handle.settled();
    recording.messages.length = 0;
    appendRow();
    appendRow();
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    await handle.settled();
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    const observations = recording.messages.find((m) => m.type === 'observer.observations');
    expect(observations?.type === 'observer.observations' ? observations.observations.length : 0).toBe(4);
    recording.messages.length = 0;
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS * 3);
    expect(recording.messages).toEqual([]);
  });
});

describe('startObserver: what it never does', () => {
  it('on a page whose health is DEGRADED, posts the health report and never a coverage ping', async () => {
    loadPage({ folder: 'drafts' });
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS);
    await handle.settled();
    expect(types(recording.messages)).toEqual(['adapter.health']);
    expect(recording.messages[0]).toMatchObject({
      health: { status: 'DEGRADED', reasons: ['not_sent_folder'] },
    });
  });
});

describe('startObserver: one pass at a time', () => {
  it('never starts a pass while one is waiting for the service worker', async () => {
    const answers: (() => void)[] = [];
    const posted: string[] = [];
    const post = (message: BusMessage): Promise<unknown> => {
      posted.push(message.type);
      return new Promise((resolve) => {
        answers.push(() => {
          resolve(undefined);
        });
      });
    };
    handle = startObserver(sentObserver(), { post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    expect(posted).toEqual(['adapter.health']);
    appendRow();
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS * 2);
    expect(posted).toEqual(['adapter.health']);
    for (let i = 0; i < 3; i += 1) {
      answers.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(posted).toEqual(['adapter.health', 'observer.observations', 'coverage.ping', 'adapter.health']);
    while (answers.length > 0) {
      answers.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    await handle.settled();
  });

  it('disconnect: no further pass, however the page changes', async () => {
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    handle.disconnect();
    appendRow();
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS * 2);
    expect(recording.messages).toEqual([]);
  });

  it('never changes the page it reads (Hard Rule 3)', async () => {
    const before = document.documentElement.outerHTML;
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS);
    await handle.settled();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('refuses an invalid observer before reading anything', () => {
    const health = vi.fn();
    expect(() => startObserver(sentObserver({ id: 'not an id', health }))).toThrow(ObserverError);
    expect(health).not.toHaveBeenCalled();
  });
});

describe('startObserver: disconnect leaves nothing behind', () => {
  it('a pass requested while one is waiting never starts after disconnect', async () => {
    const answers: (() => void)[] = [];
    const posted: string[] = [];
    const post = (message: BusMessage): Promise<unknown> => {
      posted.push(message.type);
      return new Promise((resolve) => {
        answers.push(() => {
          resolve(undefined);
        });
      });
    };
    handle = startObserver(sentObserver(), { post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    appendRow();
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    handle.disconnect();
    while (answers.length > 0) {
      answers.shift()?.();
      await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS);
    }
    await handle.settled();
    expect(posted).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
  });

  it('removes every listener it added, with the options it added it with', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const docAdded = vi.spyOn(document, 'addEventListener');
    const docRemoved = vi.spyOn(document, 'removeEventListener');
    handle = startObserver(sentObserver(), { post: recordingPost().post, now });
    expect(added.mock.calls.length).toBeGreaterThan(0);
    for (const [, , options] of added.mock.calls) expect(options).toEqual({ capture: true, passive: true });
    handle.disconnect();
    expect(removed.mock.calls).toEqual(added.mock.calls);
    expect(docRemoved.mock.calls).toEqual(docAdded.mock.calls);
  });

  it('invalid batching options throw before any listener or watcher is attached', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const docAdded = vi.spyOn(document, 'addEventListener');
    let watchers = 0;
    class Watcher extends MutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        watchers += 1;
      }
    }
    const start = (): ObserverHandle => startObserver(sentObserver(), { debounceMs: 0, Watcher });
    expect(start).toThrow(new ObserverError('invalid_options'));
    expect(added).not.toHaveBeenCalled();
    expect(docAdded).not.toHaveBeenCalled();
    expect(watchers).toBe(0);
  });
});

describe('startObserver: what it watches', () => {
  it('a page that replaces its whole body is read again (the document is watched, not the body)', async () => {
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    await handle.settled();
    recording.messages.length = 0;
    const fresh = new DOMParser().parseFromString(pageHtml({ folder: 'drafts' }), 'text/html').body;
    document.documentElement.replaceChild(document.importNode(fresh, true), document.body);
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    await handle.settled();
    expect(recording.messages).toMatchObject([
      { type: 'adapter.health', health: { status: 'DEGRADED', reasons: ['not_sent_folder'] } },
    ]);
  });
});

describe('startObserver: a prerendered page (Hard Rule 11)', () => {
  let prerendering = true;
  beforeEach(() => {
    prerendering = true;
    Object.defineProperty(document, 'prerendering', { configurable: true, get: () => prerendering });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, 'prerendering');
  });

  it('is never read while Chrome prerenders it, however it changes', async () => {
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    appendRow();
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS * 3);
    await handle.settled();
    expect(recording.messages).toEqual([]);
  });

  it('is read one debounce after the user opens it', async () => {
    const recording = recordingPost();
    handle = startObserver(sentObserver(), { post: recording.post, now });
    await vi.advanceTimersByTimeAsync(OBSERVER_MAX_WAIT_MS);
    prerendering = false;
    document.dispatchEvent(new Event('prerenderingchange'));
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS - 1);
    expect(recording.messages).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await handle.settled();
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
  });
});

describe('through the real bus', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    connectAs(contentScript());
  });

  it('the service worker receives health, observations and the ping, all valid, no secret among them', async () => {
    const received: BusMessage[] = [];
    const record = (message: BusMessage): void => {
      received.push(message);
    };
    const unlisten = listen({
      'adapter.health': record,
      'observer.observations': record,
      'coverage.ping': record,
    });
    handle = startObserver(sentObserver(), { now });
    await vi.advanceTimersByTimeAsync(OBSERVER_DEBOUNCE_MS);
    await handle.settled();
    unlisten();
    expect(types(received)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
    expect(received.at(-1)).toMatchObject({ ping: { observerId: 'synthetic.sent', userActive: false } });
    expect(leaks(received)).toEqual([]);
  });
});
