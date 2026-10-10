/**
 * The person's own model key (sprint_5 5.3; agents/intel_engineer.md rule 6). `byo.save`, which only an extension page
 * may send, keeps the key and its vendor in `chrome.storage.local` (STORAGE_KEYS.BYO_KEY, BYO_VENDOR) after closing
 * that area to content scripts (`setAccessLevel` TRUSTED_CONTEXTS, Chrome 102 and later): a script on a Gmail or
 * Calendar page can read nothing there. The area is closed again at every install, update and browser start
 * (`closeStorage`), so it never stays open. `byo.forget` deletes both and turns the person's own key off (flag
 * ATTEST_MODEL_BYO). The vendor is written only with its key and removed with it, so the options page knows a key is
 * saved by reading the vendor alone. The key is never logged and never in the ledger, so never in an export; it goes
 * only to its vendor (src/intel/providers/byo.ts).
 */
import { browser } from 'wxt/browser';
import { z } from 'zod';

import {
  type ByoSaveMessage,
  ByoKey,
  ByoVendorName,
  type LedgerTable,
  type SettingResult,
} from '../bus/messages';
import { STORAGE_KEYS } from '../config';
import { saveFlag } from '../ledger/consent';
import type { LedgerDb } from '../ledger/db';
import { log } from '../log';
import { stopModelRuns } from './model-run';

/** The key and its vendor as stored, read back through the schemas the bus checked them with. */
export const StoredByo = z.strictObject({ vendor: ByoVendorName, key: ByoKey });
export type StoredByo = z.infer<typeof StoredByo>;

export type ByoStorage = Pick<typeof browser.storage.local, 'get' | 'set' | 'remove' | 'setAccessLevel'>;

export interface ByoContext {
  readonly db: () => Promise<LedgerDb>;
  readonly notify: (tables: readonly LedgerTable[]) => void;
  /** `chrome.storage.local` when absent. */
  readonly storage?: ByoStorage;
}

const local = (): ByoStorage => browser.storage.local;

/** Closes `chrome.storage.local` to content scripts (header). */
export async function closeStorage(storage: ByoStorage = local()): Promise<void> {
  await storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

/** The saved key and its vendor, or null when none is saved or what is stored is not one (logged, never the value). */
export async function readByo(storage: ByoStorage = local()): Promise<StoredByo | null> {
  const stored = await storage.get([STORAGE_KEYS.BYO_VENDOR, STORAGE_KEYS.BYO_KEY]);
  const vendor: unknown = stored[STORAGE_KEYS.BYO_VENDOR];
  const key: unknown = stored[STORAGE_KEYS.BYO_KEY];
  if (vendor === undefined && key === undefined) return null;
  const parsed = StoredByo.safeParse({ vendor, key });
  if (parsed.success) return parsed.data;
  log.warn('byo.stored_invalid');
  return null;
}

/** Saves the person's key and its vendor (header), the area closed to content scripts first. */
export async function onByoSave(message: ByoSaveMessage, ctx: ByoContext): Promise<SettingResult> {
  const storage = ctx.storage ?? local();
  // A run under way keeps the key it began with: stop it, so nothing more goes with that key (SEC-2).
  stopModelRuns();
  try {
    await closeStorage(storage);
    await storage.set({ [STORAGE_KEYS.BYO_KEY]: message.key, [STORAGE_KEYS.BYO_VENDOR]: message.vendor });
  } catch (error) {
    log.error('byo.save_failed', { error });
    return { ok: false, code: 'failed' };
  }
  log.info('byo.saved', { vendor: message.vendor });
  ctx.notify(['meta']);
  return { ok: true };
}

/** Deletes the person's key and its vendor, and turns their own key off (header). */
export async function onByoForget(ctx: ByoContext): Promise<SettingResult> {
  const storage = ctx.storage ?? local();
  // Nothing more goes with the key from the moment the person forgets it, a call in flight included (SEC-2).
  stopModelRuns();
  try {
    await storage.remove([STORAGE_KEYS.BYO_KEY, STORAGE_KEYS.BYO_VENDOR]);
    await saveFlag(await ctx.db(), 'ATTEST_MODEL_BYO', false);
  } catch (error) {
    log.error('byo.forget_failed', { error });
    return { ok: false, code: 'failed' };
  }
  log.info('byo.forgotten');
  ctx.notify(['meta']);
  return { ok: true };
}
