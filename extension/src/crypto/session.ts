/**
 * The copy of the ledger's keys the extension's pages read (sprint_6 6.5): `chrome.storage.session`
 * (SESSION_KEYS.LEDGER_KEYS), which lives in memory only and which Chrome empties when the browser closes or the
 * extension reloads. The service worker that unlocked the keys writes it, and clears it at its every start
 * (src/background/crypto.ts), so pages read the ledger without waking the worker, and a restart of the worker locks
 * the ledger everywhere. A content script never reads this area: its access level stays Chrome's default, extension
 * contexts only, and Attest never widens it. Never logged, never exported.
 */
import { browser } from 'wxt/browser';
import { z } from 'zod';

import { SESSION_KEYS } from '../config';
import { LEDGER_KEY_BYTES } from '../config-crypto';
import { fromBase64, toBase64 } from './bytes';
import type { LedgerKey } from './kdf';

const StoredKey = z.strictObject({ id: z.string().regex(/^[0-9a-f]{12}$/u), key: z.string().max(64) });
const StoredKeys = z.strictObject({ current: StoredKey.optional(), previous: StoredKey.optional() });

export interface SessionKeys {
  readonly current?: LedgerKey;
  readonly previous?: LedgerKey;
}

const keyOf = (stored: z.infer<typeof StoredKey> | undefined): LedgerKey | undefined => {
  if (stored === undefined) return undefined;
  const bytes = fromBase64(stored.key);
  return bytes.length === LEDGER_KEY_BYTES ? { id: stored.id, bytes } : undefined;
};

/** The keys this session holds: none when the ledger is locked or encryption is off; a malformed entry is none. */
export async function readSessionKeys(): Promise<SessionKeys> {
  const held = await browser.storage.session.get(SESSION_KEYS.LEDGER_KEYS);
  const parsed = StoredKeys.safeParse(held[SESSION_KEYS.LEDGER_KEYS]);
  if (!parsed.success) return {};
  const current = keyOf(parsed.data.current);
  const previous = keyOf(parsed.data.previous);
  return { ...(current === undefined ? {} : { current }), ...(previous === undefined ? {} : { previous }) };
}

/** Keeps `keys` for this session, replacing any held. */
export async function writeSessionKeys(keys: SessionKeys): Promise<void> {
  const text = (key: LedgerKey | undefined) =>
    key === undefined ? {} : { id: key.id, key: toBase64(key.bytes) };
  await browser.storage.session.set({
    [SESSION_KEYS.LEDGER_KEYS]: {
      ...(keys.current === undefined ? {} : { current: text(keys.current) }),
      ...(keys.previous === undefined ? {} : { previous: text(keys.previous) }),
    },
  });
}

/** Forgets every key this session holds: the ledger locks everywhere. */
export async function clearSessionKeys(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEYS.LEDGER_KEYS);
}

/** Calls `listener` whenever the session's keys change; returns the unsubscribe. */
export function onSessionKeysChanged(listener: () => void): () => void {
  const changed = (changes: Record<string, unknown>, area: string) => {
    if (area === 'session' && SESSION_KEYS.LEDGER_KEYS in changes) listener();
  };
  browser.storage.onChanged.addListener(changed);
  return () => {
    browser.storage.onChanged.removeListener(changed);
  };
}
