/**
 * The session's mark that the service worker is rebuilding the ledger's database (Sprint 6 close, security review
 * SEC-1; ./rebuild.ts): set before the ledger is deleted, removed once every row is back. While it is set, a page
 * waits to read (./shared.ts), so it never reads a ledger half put back; and the options page's Encryption says what
 * is happening. In `chrome.storage.session`, memory only, as the keys are (src/crypto/session.ts). Only the service
 * worker sets or removes it.
 */
import { browser } from 'wxt/browser';

import { SESSION_KEYS } from '../config';

/** Whether a rebuild is under way. */
export async function readRebuildMark(): Promise<boolean> {
  const held = await browser.storage.session.get(SESSION_KEYS.LEDGER_REBUILD);
  return held[SESSION_KEYS.LEDGER_REBUILD] === true;
}

/** Sets the mark (a rebuild starts) or removes it (it ended). */
export async function setRebuildMark(on: boolean): Promise<void> {
  if (on) await browser.storage.session.set({ [SESSION_KEYS.LEDGER_REBUILD]: true });
  else await browser.storage.session.remove(SESSION_KEYS.LEDGER_REBUILD);
}

/** Calls `listener` with the mark whenever it changes; returns the unsubscribe. */
export function onRebuildMarkChanged(listener: (on: boolean) => void): () => void {
  const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[SESSION_KEYS.LEDGER_REBUILD];
    if (area === 'session' && change !== undefined) listener(change.newValue === true);
  };
  browser.storage.onChanged.addListener(changed);
  return () => {
    browser.storage.onChanged.removeListener(changed);
  };
}
