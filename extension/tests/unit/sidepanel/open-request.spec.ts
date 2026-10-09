// @vitest-environment happy-dom
/**
 * The receipt a clicked alert asks the side panel to open (sprint_4 4.6; entrypoints/sidepanel/use-open-request.ts):
 * from the address (`#receipt=<id>`), from the session store when the panel opens or while it is open, each once (the
 * store's entry is removed, and its removal reads nothing again), and never anything that is not a receipt's id.
 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type OpenRequestStore,
  receiptOfHash,
  useOpenRequest,
} from '../../../entrypoints/sidepanel/use-open-request';
import { SESSION_KEYS } from '../../../src/config';
import { setLogSink } from '../../../src/log';

const KEY = SESSION_KEYS.OPEN_RECEIPT;
const ID_A = '01JA0000000000000000000001';
const ID_B = '01JA0000000000000000000002';

let root: HTMLElement;
let opened: string[];
let stored: Record<string, unknown>;
let onChange: () => void;
let reads: number;

const store: OpenRequestStore = {
  get: (key) => {
    reads += 1;
    return Promise.resolve({ [key]: stored[key] });
  },
  remove: (key) => {
    Reflect.deleteProperty(stored, key);
    return Promise.resolve();
  },
  watch: (_key, change) => {
    onChange = change;
    return () => undefined;
  },
};

function Probe({ hash }: { readonly hash: string }) {
  useOpenRequest((id) => opened.push(id), store, hash);
  return null;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  opened = [];
  stored = {};
  onChange = () => undefined;
  reads = 0;
  setLogSink(() => undefined);
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

async function mount(hash = ''): Promise<void> {
  await act(() => {
    render(h(Probe, { hash }), root);
  });
  await settle();
}

describe('useOpenRequest', () => {
  it('opens the receipt the store names when the panel opens, once, and removes it', async () => {
    stored[KEY] = ID_A;
    await mount();
    expect(opened).toEqual([ID_A]);
    expect(stored).toEqual({});
    stored[KEY] = ID_B;
    await act(() => {
      onChange();
    });
    await settle();
    expect(opened).toEqual([ID_A, ID_B]);
    expect(reads).toBe(2);
  });

  it('opens the receipt the address names, and nothing that is not a receipt id', async () => {
    await mount(`#receipt=${ID_A}`);
    expect(opened).toEqual([ID_A]);
    expect(receiptOfHash('#receipt=not-an-id')).toBeUndefined();
    expect(receiptOfHash('#other')).toBeUndefined();
    render(null, root);
    opened = [];
    stored[KEY] = 'priya@example.com';
    await mount();
    expect(opened).toEqual([]);
    expect(stored).toEqual({});
  });
});
