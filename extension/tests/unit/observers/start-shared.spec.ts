// @vitest-environment happy-dom
/**
 * src/observers/base.ts `startObservers` (Sprint 2 close):
 *  - TECH-2: one content script, one MutationObserver and one activity tracker for all its observers; the watcher
 *    observes the tree, the text and only the attributes the observers read (plus the shown-view ones), so a change
 *    to any other attribute starts no pass; an observer that does not say what it reads keeps every attribute
 *    watched.
 *  - Decisions [2.close] S4 (QA-V2, Hard Rule 5): a pass on a page that is offline or catching up posts its health
 *    and rows but no coverage; coverage resumes on its own once the page has caught up.
 *  - Decisions [2.close] S5 (SEC-3): the skeleton stops when the extension context is really gone (a post refused
 *    `context_invalidated`, or no runtime id at a flush), and not otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusError } from '../../../src/bus/errors';
import type { BusMessage } from '../../../src/bus/messages';
import { isoWithLocalOffset } from '../../../src/clock';
import { OBSERVER_DEBOUNCE_MS, PAGE_RESYNC_MS } from '../../../src/config';
import { assertObserver, type ObserverHandle, startObservers } from '../../../src/observers/base';
import { VIEW_ATTRIBUTES } from '../../../src/observers/batch';
import { ObserverError } from '../../../src/observers/errors';
import { pageHtml, recordingPost, sentObserver } from './helpers';

let handle: ObserverHandle | undefined;
let online = true;
const now = (): string => isoWithLocalOffset(new Date());
const types = (messages: readonly BusMessage[]): string[] => messages.map((m) => m.type);

/** What the synthetic observer reads (tests/unit/observers/helpers.ts). */
const SENT_ATTRIBUTES = ['data-account', 'data-folder', 'data-row-key', 'datetime', 'email', 'role'];

/** A second observer on the same page (a receipt-like reader of the same rows); `null`: it names no attributes. */
const second = (attributes: readonly string[] | null = ['data-subject']) =>
  sentObserver(attributes === null ? { id: 'synthetic.second' } : { id: 'synthetic.second', attributes });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T18:30:00Z'));
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  document.body.innerHTML = new DOMParser().parseFromString(pageHtml(), 'text/html').body.innerHTML;
});

afterEach(() => {
  handle?.disconnect();
  handle = undefined;
  Reflect.deleteProperty(navigator, 'onLine');
  vi.useRealTimers();
});

/** A MutationObserver that counts itself and keeps the options it observes with. */
function countingWatcher(): {
  readonly Watcher: typeof MutationObserver;
  readonly inits: MutationObserverInit[];
} {
  const inits: MutationObserverInit[] = [];
  class Watcher extends MutationObserver {
    override observe(target: Node, init?: MutationObserverInit): void {
      inits.push({ ...init });
      super.observe(target, init);
    }
  }
  return { Watcher, inits };
}

/** How many passes posted their health report (every pass posts one), by observer. */
function passesOf(messages: readonly BusMessage[], observerId: string): number {
  return messages.filter((m) => m.type === 'adapter.health' && m.health.adapterId === observerId).length;
}

async function settle(ms = OBSERVER_DEBOUNCE_MS): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await handle?.settled();
}

describe('one watcher and one activity tracker per content script (TECH-2)', () => {
  it('two observers share one MutationObserver and one set of input listeners, and each runs its passes', async () => {
    const one = countingWatcher();
    const listening = vi.spyOn(window, 'addEventListener');
    handle = startObservers([sentObserver({ attributes: SENT_ATTRIBUTES })], { Watcher: one.Watcher, now });
    const alone = listening.mock.calls.length;
    handle.disconnect();
    listening.mockClear();
    const recording = recordingPost();
    const both = countingWatcher();
    handle = startObservers([sentObserver({ attributes: SENT_ATTRIBUTES }), second()], {
      Watcher: both.Watcher,
      post: recording.post,
      now,
    });
    expect(both.inits).toHaveLength(1);
    expect(listening.mock.calls.length).toBe(alone);
    await settle();
    expect(passesOf(recording.messages, 'synthetic.sent')).toBe(1);
    expect(passesOf(recording.messages, 'synthetic.second')).toBe(1);
  });

  it('watches only the attributes its observers read, plus the shown-view ones', () => {
    const watching = countingWatcher();
    handle = startObservers([sentObserver({ attributes: SENT_ATTRIBUTES }), second()], {
      Watcher: watching.Watcher,
      now,
    });
    expect(watching.inits).toEqual([
      {
        childList: true,
        subtree: true,
        characterData: true,
        attributeFilter: [...new Set([...SENT_ATTRIBUTES, 'data-subject', ...VIEW_ATTRIBUTES])].sort(),
      },
    ]);
  });

  it('watches every attribute when one observer does not say which it reads', () => {
    const watching = countingWatcher();
    handle = startObservers([sentObserver({ attributes: SENT_ATTRIBUTES }), second(null)], {
      Watcher: watching.Watcher,
      now,
    });
    expect(watching.inits).toEqual([
      { childList: true, subtree: true, characterData: true, attributes: true },
    ]);
  });
});

describe('the watched attributes (TECH-2)', () => {
  it('a change to an attribute nobody reads starts no pass; one the observers read does', async () => {
    const recording = recordingPost();
    handle = startObservers([sentObserver({ attributes: SENT_ATTRIBUTES })], { post: recording.post, now });
    await settle();
    recording.messages.length = 0;
    const row = document.querySelector('[role="row"]');
    row?.setAttribute('aria-expanded', 'true');
    row?.setAttribute('data-hover', 'yes');
    await settle(OBSERVER_DEBOUNCE_MS * 4);
    expect(recording.messages).toEqual([]);
    row?.setAttribute('data-row-key', 'r9');
    await settle();
    expect(passesOf(recording.messages, 'synthetic.sent')).toBe(1);
    recording.messages.length = 0;
    row?.setAttribute('class', 'shown-elsewhere');
    await settle();
    expect(passesOf(recording.messages, 'synthetic.sent')).toBe(1);
  });

  it('refuses an observer whose attributes are not attribute names, and an empty list of observers', () => {
    for (const attributes of [['[role]'], ['role="main"'], [''], 'role']) {
      const bad = sentObserver({ attributes: attributes as readonly string[] });
      expect(() => {
        assertObserver(bad);
      }).toThrow(new ObserverError('invalid_observer'));
    }
    expect(() => startObservers([])).toThrow(new ObserverError('invalid_observer'));
  });
});

describe('a page that is offline or catching up posts no coverage (Decisions [2.close] S4)', () => {
  it('offline: health and rows, no ping; back online: no ping until the page caught up, then one on its own', async () => {
    const recording = recordingPost();
    online = false;
    handle = startObservers([sentObserver()], { post: recording.post, now });
    await settle();
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations']);
    expect(recording.messages[0]).toMatchObject({ health: { status: 'OK' } });
    recording.messages.length = 0;
    online = true;
    window.dispatchEvent(new Event('online'));
    document.querySelector('[role="grid"]')?.append(document.createElement('div'));
    await settle();
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations']);
    recording.messages.length = 0;
    // Nothing on the page changes: the skeleton asks for the pass that vouches once PAGE_RESYNC_MS is up.
    await settle(PAGE_RESYNC_MS);
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
  });

  it('a page that was online all along posts its ping at the first pass (the control)', async () => {
    const recording = recordingPost();
    handle = startObservers([sentObserver()], { post: recording.post, now });
    await settle();
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
  });
});

describe('the skeleton stops only when the extension context is gone (Decisions [2.close] S5)', () => {
  it('a post refused context_invalidated stops every observer and removes every listener', async () => {
    const posted: string[] = [];
    const post = (message: BusMessage): Promise<unknown> => {
      posted.push(message.type);
      return Promise.reject(new BusError('context_invalidated'));
    };
    const removed = vi.spyOn(window, 'removeEventListener');
    handle = startObservers([sentObserver(), second()], { post, now });
    await settle();
    expect(posted).toEqual(['adapter.health', 'adapter.health']);
    expect(removed).toHaveBeenCalled();
    document.querySelector('[role="grid"]')?.append(document.createElement('div'));
    await settle(OBSERVER_DEBOUNCE_MS * 4);
    expect(posted).toEqual(['adapter.health', 'adapter.health']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a flush with no runtime id stops everything before reading the page', async () => {
    const recording = recordingPost();
    handle = startObservers([sentObserver()], { post: recording.post, now, contextAlive: () => false });
    await settle(OBSERVER_DEBOUNCE_MS * 4);
    expect(recording.messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('any other refusal, or a page-made start-up event, stops nothing', async () => {
    let refuse = true;
    const recording = recordingPost();
    const post = (message: BusMessage): Promise<unknown> =>
      refuse ? Promise.reject(new BusError('refused')) : recording.post(message);
    handle = startObservers([sentObserver()], { post, now });
    await settle();
    refuse = false;
    const detail = { contentScriptName: 'gmail', messageId: 'forged' };
    document.dispatchEvent(new CustomEvent('test-extension-id:gmail:wxt:content-script-started', { detail }));
    document.querySelector('[role="grid"]')?.append(document.createElement('div'));
    await settle();
    expect(types(recording.messages)).toEqual(['adapter.health', 'observer.observations', 'coverage.ping']);
  });
});
