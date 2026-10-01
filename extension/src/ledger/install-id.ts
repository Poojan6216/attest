/**
 * The install id: a random v4 UUID kept in `chrome.storage.local` (build_spec §5: storage.local holds only
 * small flags and the install id).
 *
 * It identifies nothing about the user. Its only future use is the opt-in, off-by-default telemetry
 * (Sprint 5), and the user can reset it from Options → Danger zone at any time, which unlinks past and
 * future reports. It is never logged (Hard Rule 10).
 *
 * Stored data is parsed on read: a missing or corrupt value is replaced with a fresh id, loudly.
 */
import { browser } from 'wxt/browser';
import { z } from 'zod';

import { STORAGE_KEYS } from '../config';
import { log } from '../log';

/** A random RFC 9562 version-4 UUID, lowercase as `crypto.randomUUID()` produces it. */
export const InstallId = z.uuidv4().regex(/^[0-9a-f-]+$/, 'expected a lowercase UUID');
export type InstallId = z.infer<typeof InstallId>;

export type InstallIdErrorCode = 'read_failed' | 'write_failed';

/** Storage failed underneath the install id. The cause is kept for debugging; its message is never logged. */
export class InstallIdError extends Error {
  readonly code: InstallIdErrorCode;

  constructor(code: InstallIdErrorCode, cause: unknown) {
    super(`install id storage ${code}`, { cause });
    this.name = 'InstallIdError';
    this.code = code;
  }
}

type StoredInstallId =
  | { readonly kind: 'valid'; readonly id: InstallId }
  | { readonly kind: 'missing' }
  | { readonly kind: 'corrupt' };

async function readStored(): Promise<StoredInstallId> {
  let items: Record<string, unknown>;
  try {
    items = await browser.storage.local.get(STORAGE_KEYS.INSTALL_ID);
  } catch (error) {
    throw new InstallIdError('read_failed', error);
  }
  const raw = items[STORAGE_KEYS.INSTALL_ID];
  if (raw === undefined) return { kind: 'missing' };
  const parsed = InstallId.safeParse(raw);
  return parsed.success ? { kind: 'valid', id: parsed.data } : { kind: 'corrupt' };
}

/**
 * Writes a fresh id and returns what storage now holds. When two contexts race to create the id (service
 * worker on install, options page on open) the last write wins. Reading back lets a context whose write
 * was overtaken before its read return the winner. It cannot help a context that read before the other
 * wrote; `onInstallIdChanged` corrects any page that shows the id.
 */
async function writeFreshId(): Promise<InstallId> {
  const id = InstallId.parse(crypto.randomUUID());
  try {
    await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_ID]: id });
  } catch (error) {
    throw new InstallIdError('write_failed', error);
  }
  const stored = await readStored();
  return stored.kind === 'valid' ? stored.id : id;
}

/**
 * Returns the stored id, creating it when it does not exist yet. Called by the service worker on install
 * and update, where a missing id is expected (first install) and is not a warning.
 */
export async function ensureInstallId(): Promise<InstallId> {
  const stored = await readStored();
  if (stored.kind === 'valid') return stored.id;
  const id = await writeFreshId();
  if (stored.kind === 'missing') {
    log.info('install_id.created');
  } else {
    log.warn('install_id.regenerated', { reason: stored.kind });
  }
  return id;
}

/**
 * Returns the stored id. The install handler should already have created it, so a missing value is as
 * unexpected as a corrupt one: both are regenerated and logged as a warning (Hard Rule 6: fail loud).
 */
export async function getInstallId(): Promise<InstallId> {
  const stored = await readStored();
  if (stored.kind === 'valid') return stored.id;
  const id = await writeFreshId();
  log.warn('install_id.regenerated', { reason: stored.kind });
  return id;
}

/** Replaces the id with a new random one. Past and future telemetry reports can no longer be linked. */
export async function resetInstallId(): Promise<InstallId> {
  const id = await writeFreshId();
  log.info('install_id.reset');
  return id;
}

/**
 * Calls `listener` whenever the stored id changes in any context (another options tab, the service
 * worker). The new value is parsed: anything that is not a valid id arrives as `null`.
 * Returns an unsubscribe function.
 */
export function onInstallIdChanged(listener: (id: InstallId | null) => void): () => void {
  const handle = (changes: Readonly<Record<string, { newValue?: unknown }>>): void => {
    const change = changes[STORAGE_KEYS.INSTALL_ID];
    if (change === undefined) return;
    const parsed = InstallId.safeParse(change.newValue);
    listener(parsed.success ? parsed.data : null);
  };
  browser.storage.local.onChanged.addListener(handle);
  return () => {
    browser.storage.local.onChanged.removeListener(handle);
  };
}
