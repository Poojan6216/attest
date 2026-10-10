// @vitest-environment happy-dom
/**
 * A page's ordered read of the ledger (src/ui/use-ledger-read.ts; sprint_4 close, tech review TECH-2): a read for a
 * request since replaced lands nowhere, even when it resolves last; a change announced during a read reads once more
 * after it, never two at once; and a read that fails is said and passed on to be logged. Every value is invented.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LedgerRead, useLedgerRead } from '../../../src/ui/use-ledger-read';

let root: HTMLElement;
let shown: LedgerRead<string>;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

function Reader(props: {
  load: () => Promise<string>;
  subscribe: (onChange: () => void) => () => void;
  onError: (error: unknown) => void;
}) {
  shown = useLedgerRead(props.load, props.subscribe, props.onError);
  return null;
}

const never = () => () => undefined;

describe('useLedgerRead', () => {
  it('drops a read for a request since replaced, though it lands last', async () => {
    let releaseOld: (value: string) => void = () => undefined;
    const oldLoad = () => new Promise<string>((resolve) => (releaseOld = resolve));
    const newLoad = () => Promise.resolve('week 2');
    const onError = vi.fn();
    await act(() => {
      render(h(Reader, { load: oldLoad, subscribe: never, onError }), root);
    });
    await act(() => {
      render(h(Reader, { load: newLoad, subscribe: never, onError }), root);
    });
    await settle();
    expect(shown).toEqual({ status: 'ready', value: 'week 2' });
    await act(() => {
      releaseOld('week 1');
    });
    await settle();
    expect(shown).toEqual({ status: 'ready', value: 'week 2' });
  });
});

describe('useLedgerRead, as changes arrive', () => {
  it('reads once more after a change announced during a read, never two at once', async () => {
    let running = 0;
    let most = 0;
    let reads = 0;
    let release: () => void = () => undefined;
    let announce: () => void = () => undefined;
    const load = () => {
      reads += 1;
      running += 1;
      most = Math.max(most, running);
      return new Promise<string>((resolve) => {
        release = () => {
          running -= 1;
          resolve(`read ${String(reads)}`);
        };
      });
    };
    const subscribe = (onChange: () => void) => {
      announce = onChange;
      return () => undefined;
    };
    await act(() => {
      render(h(Reader, { load, subscribe, onError: vi.fn() }), root);
    });
    await act(() => {
      announce();
      announce();
    });
    await act(() => {
      release();
    });
    await settle();
    await act(() => {
      release();
    });
    await settle();
    expect(reads).toBe(2);
    expect(most).toBe(1);
    expect(shown).toEqual({ status: 'ready', value: 'read 2' });
  });

  it('says a read that failed, and passes it on to be logged', async () => {
    const onError = vi.fn();
    await act(() => {
      render(h(Reader, { load: () => Promise.reject(new Error('closed')), subscribe: never, onError }), root);
    });
    await settle();
    expect(shown).toEqual({ status: 'failed' });
    expect(onError).toHaveBeenCalledOnce();
  });
});
