// @vitest-environment happy-dom
/**
 * src/observers/batch.ts (sprint_2 2.0): DOM mutations batch into passes, debounced by OBSERVER_DEBOUNCE_MS and
 * never later than OBSERVER_MAX_WAIT_MS after the first, driven by fake timers. Watching never changes the DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OBSERVER_DEBOUNCE_MS, OBSERVER_MAX_WAIT_MS } from '../../../src/config';
import { createBatcher, MUTATION_INIT, type Timers, watchMutations } from '../../../src/observers/batch';
import { ObserverError } from '../../../src/observers/errors';

const options = { debounceMs: OBSERVER_DEBOUNCE_MS, maxWaitMs: OBSERVER_MAX_WAIT_MS };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('constants', () => {
  it('watches the whole tree: children, text and attributes', () => {
    expect(MUTATION_INIT).toEqual({ childList: true, subtree: true, characterData: true, attributes: true });
    expect(Object.isFrozen(MUTATION_INIT)).toBe(true);
  });

  it('are the sprint_2 2.0 values: debounce 500 ms, max wait 2 s', () => {
    expect(OBSERVER_DEBOUNCE_MS).toBe(500);
    expect(OBSERVER_MAX_WAIT_MS).toBe(2_000);
  });
});

describe('createBatcher', () => {
  it('flushes once, one debounce after a single poke', () => {
    const flush = vi.fn();
    createBatcher(flush, options).poke();
    vi.advanceTimersByTime(OBSERVER_DEBOUNCE_MS - 1);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(OBSERVER_MAX_WAIT_MS * 2);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('a burst of pokes inside the debounce flushes once, one debounce after the last', () => {
    const flush = vi.fn();
    const batcher = createBatcher(flush, options);
    for (let i = 0; i < 4; i += 1) {
      batcher.poke();
      vi.advanceTimersByTime(100);
    }
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(OBSERVER_DEBOUNCE_MS - 100);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('a page that never goes quiet is still read at the max wait, then again every max wait', () => {
    const flush = vi.fn();
    const batcher = createBatcher(flush, options);
    const flushedAt: number[] = [];
    flush.mockImplementation(() => flushedAt.push(Date.now()));
    const start = Date.now();
    for (let elapsed = 0; elapsed < 5_000; elapsed += 400) {
      batcher.poke();
      vi.advanceTimersByTime(400);
    }
    expect(flushedAt.map((at) => at - start)).toEqual([2_000, 4_000]);
  });

  it('a poke during a flush starts the next burst', () => {
    const flush = vi.fn();
    const batcher = createBatcher(() => {
      flush();
      if (flush.mock.calls.length === 1) batcher.poke();
    }, options);
    batcher.poke();
    vi.advanceTimersByTime(OBSERVER_DEBOUNCE_MS);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(OBSERVER_DEBOUNCE_MS);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

describe('createBatcher: control and options', () => {
  it('cancel drops a pending flush; a later poke starts afresh', () => {
    const flush = vi.fn();
    const batcher = createBatcher(flush, options);
    batcher.poke();
    batcher.cancel();
    vi.advanceTimersByTime(OBSERVER_MAX_WAIT_MS * 2);
    expect(flush).not.toHaveBeenCalled();
    batcher.poke();
    vi.advanceTimersByTime(OBSERVER_DEBOUNCE_MS);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('uses injected timers when given', () => {
    const handle = globalThis.setTimeout(() => undefined, 0);
    globalThis.clearTimeout(handle);
    const setTimeout = vi.fn<Timers['setTimeout']>(() => handle);
    const clearTimeout = vi.fn();
    createBatcher(vi.fn(), { ...options, timers: { setTimeout, clearTimeout } }).poke();
    expect(setTimeout.mock.calls.map((call) => call[1])).toEqual([
      OBSERVER_DEBOUNCE_MS,
      OBSERVER_MAX_WAIT_MS,
    ]);
  });

  it.each([
    [0, 2_000],
    [-1, 2_000],
    [500, 400],
    [1.5, 2_000],
    [Number.NaN, 2_000],
    [500, Number.POSITIVE_INFINITY],
  ])('refuses debounce %s with max wait %s (ObserverError invalid_options)', (debounceMs, maxWaitMs) => {
    expect(() => createBatcher(vi.fn(), { debounceMs, maxWaitMs })).toThrow(ObserverError);
    expect(() => createBatcher(vi.fn(), { debounceMs, maxWaitMs })).toThrow('observer: invalid_options');
  });
});

describe('watchMutations', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main role="main"><div role="row" title="t">a</div></main>';
  });

  it('calls onChange for child, text and attribute changes anywhere under the target', async () => {
    const onChange = vi.fn();
    const watch = watchMutations(document, onChange);
    document.querySelector('main')?.append(document.createElement('div'));
    await vi.runAllTimersAsync();
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    const text = document.querySelector('[role="row"]')?.firstChild;
    if (text) text.textContent = 'b';
    await vi.runAllTimersAsync();
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    document.querySelector('[role="row"]')?.setAttribute('title', 'u');
    await vi.runAllTimersAsync();
    expect(onChange).toHaveBeenCalled();
    watch.disconnect();
  });

  it('never changes the DOM, and stops after disconnect', async () => {
    const before = document.documentElement.outerHTML;
    const onChange = vi.fn();
    const watch = watchMutations(document, onChange);
    await vi.runAllTimersAsync();
    expect(document.documentElement.outerHTML).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
    watch.disconnect();
    document.body.append(document.createElement('p'));
    await vi.runAllTimersAsync();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never reads the mutation records', () => {
    let callback: MutationCallback | undefined;
    class Watcher extends MutationObserver {
      constructor(cb: MutationCallback) {
        super(cb);
        callback = cb;
      }
    }
    const onChange = vi.fn();
    const watch = watchMutations(document, onChange, Watcher);
    const records = new Proxy<MutationRecord[]>([], {
      get: () => {
        throw new Error('records were read');
      },
    });
    callback?.(records, {} as MutationObserver);
    expect(onChange).toHaveBeenCalledWith();
    watch.disconnect();
  });
});
