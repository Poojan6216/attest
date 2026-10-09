/**
 * The receipt a clicked alert asks the side panel to open (sprint_4 4.6; src/background/alerts.ts): named in
 * `chrome.storage.session` (`SESSION_KEYS.OPEN_RECEIPT`), read when the panel opens and while it is open, then removed,
 * so it opens once; or in the address (`#receipt=<id>`) when Chrome would not open the panel and its page opened in a
 * tab. Only a receipt id is ever opened: anything else stored there is removed and ignored.
 */
import { useEffect, useRef } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { SESSION_KEYS } from '../../src/config';
import { Ulid } from '../../src/core/schema';
import { log } from '../../src/log';

const KEY = SESSION_KEYS.OPEN_RECEIPT;

/** The part of `chrome.storage.session` the request uses. */
export interface OpenRequestStore {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
  /** Calls `onChange` when `key` changes; returns how to stop. */
  watch(key: string, onChange: () => void): () => void;
}

export const SESSION_STORE: OpenRequestStore = {
  get: (key) => browser.storage.session.get(key),
  remove: (key) => browser.storage.session.remove(key),
  watch: (key, onChange) => {
    // Only a value set calls `onChange`: the removal that follows a read changes the key too, and must not read again.
    const listener = (changes: Record<string, { newValue?: unknown }>): void => {
      if (typeof changes[key]?.newValue === 'string') onChange();
    };
    browser.storage.session.onChanged.addListener(listener);
    return () => {
      browser.storage.session.onChanged.removeListener(listener);
    };
  },
};

/** The receipt `#receipt=<id>` names, when the address holds one. */
export function receiptOfHash(hash: string): string | undefined {
  const named = /^#receipt=(.+)$/u.exec(hash)?.[1];
  const id = Ulid.safeParse(named);
  return id.success ? id.data : undefined;
}

/** Opens (`open`) each receipt an alert names, once (header). */
export function useOpenRequest(
  open: (receiptId: string) => void,
  store: OpenRequestStore = SESSION_STORE,
  hash: string = location.hash,
): void {
  const opener = useRef(open);
  opener.current = open;
  useEffect(() => {
    const fromHash = receiptOfHash(hash);
    if (fromHash !== undefined) opener.current(fromHash);
    const take = (): void => {
      store
        .get(KEY)
        .then(async (items) => {
          const named = items[KEY];
          if (named === undefined || named === null) return;
          await store.remove(KEY);
          const id = Ulid.safeParse(named);
          if (id.success) opener.current(id.data);
        })
        .catch((error: unknown) => {
          log.warn('sidepanel.open_request_failed', { error });
        });
    };
    take();
    return store.watch(KEY, take);
  }, [store, hash]);
}
