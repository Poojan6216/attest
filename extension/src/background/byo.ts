/**
 * The person's own model key (sprint_5 5.3; agents/intel_engineer.md rule 6). `byo.save`, which only an extension page
 * may send, keeps the key and its vendor in `chrome.storage.local` (STORAGE_KEYS.BYO_KEY, BYO_VENDOR) after closing
 * that area to content scripts (`setAccessLevel` TRUSTED_CONTEXTS, Chrome 102 and later): a script on a Gmail or
 * Calendar page can read nothing there. The area is closed again at every install, update and browser start
 * (`closeStorage`), so it never stays open. `byo.forget` deletes both and turns the person's own key off (flag
 * ATTEST_MODEL_BYO). The vendor is written only with its key and removed with it, so the options page knows a key is
 * saved by reading the vendor alone. The key is never logged and never in the ledger, so never in an export; it goes
 * only to its vendor (src/intel/providers/byo.ts).
 *
 * While encryption at rest is on, the key is kept sealed under the ledger's key, as the ledger's rows are (Sprint 6
 * close, security review SEC-2): a copy of the profile does not hold it in the clear. It opens only in the service
 * worker, with a key the worker holds; while the ledger is locked it does not open, and nothing goes to the model, as
 * grading waits anyway. `sealSavedKey` keeps it as the ledger's state asks after each change of the keys
 * (./crypto.ts): sealed when encryption is turned on, sealed again under a new passphrase, opened for good when it is
 * turned off. A key cannot be saved while the ledger is locked, since it could not be sealed.
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
import { keyFitsVendor } from '../bus/page-commands';
import { STORAGE_KEYS } from '../config';
import { isLocked, keyring, keyWithId } from '../crypto/keyring';
import { openText, sealedTextKeyId, sealText } from '../crypto/seal';
import { saveFlag } from '../ledger/consent';
import type { LedgerDb } from '../ledger/db';
import { log } from '../log';
import { stopModelRuns } from './model-run';

/** The key and its vendor as stored, read back through the schemas the bus checked them with. */
export const StoredByo = z
  .strictObject({ vendor: ByoVendorName, key: ByoKey })
  // A pair whose key is not its vendor's (one saved before SEC-7's check) reads as none: nothing is sent with it.
  .refine(({ vendor, key }) => keyFitsVendor(vendor, key));
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

/** The additional data the key is sealed for: the key alone, so no sealed value from elsewhere opens as it. */
const BYO_AAD = 'byo:key';

/** A stored key as given: opened, if sealed, with a key this worker holds; `locked` when it holds none that opens it. */
function keyAsGiven(stored: unknown): unknown {
  if (typeof stored !== 'string') return stored;
  const id = sealedTextKeyId(stored);
  if (id === undefined) return stored;
  const key = keyWithId(id);
  return key === undefined ? LOCKED : openText(key, BYO_AAD, stored);
}

const LOCKED = Symbol('locked');

/** The saved key and its vendor, or null when none is saved or what is stored is not one (logged, never the value). */
export async function readByo(storage: ByoStorage = local()): Promise<StoredByo | null> {
  const stored = await storage.get([STORAGE_KEYS.BYO_VENDOR, STORAGE_KEYS.BYO_KEY]);
  const vendor: unknown = stored[STORAGE_KEYS.BYO_VENDOR];
  const raw: unknown = stored[STORAGE_KEYS.BYO_KEY];
  if (vendor === undefined && raw === undefined) return null;
  const key = keyAsGiven(raw);
  // Sealed, with no key held here to open it: the ledger is locked, and nothing goes to the model meanwhile.
  if (key === LOCKED) return null;
  const parsed = StoredByo.safeParse({ vendor, key });
  if (parsed.success) return parsed.data;
  log.warn('byo.stored_invalid');
  return null;
}

/**
 * Keeps the saved key as the ledger's state now asks (header): sealed under the current key while rows are sealed,
 * opened for good while they are not. A key it cannot open (the ledger locked) is left as it is, for the next unlock;
 * one already as asked is not written again.
 */
export async function sealSavedKey(storage: ByoStorage = local()): Promise<void> {
  const stored = await storage.get(STORAGE_KEYS.BYO_KEY);
  const raw: unknown = stored[STORAGE_KEYS.BYO_KEY];
  if (typeof raw !== 'string') return;
  const key = keyAsGiven(raw);
  if (typeof key !== 'string') return;
  const { sealing, current } = keyring();
  if (sealing && current === undefined) return;
  if (sealing && sealedTextKeyId(raw) === current?.id) return;
  const next = sealing && current !== undefined ? sealText(current, BYO_AAD, key) : key;
  if (next === raw) return;
  await storage.set({ [STORAGE_KEYS.BYO_KEY]: next });
  if (sealing) log.info('byo.key_sealed');
  else log.info('byo.key_opened');
}

/** Saves the person's key and its vendor (header), the area closed to content scripts first. */
export async function onByoSave(message: ByoSaveMessage, ctx: ByoContext): Promise<SettingResult> {
  const storage = ctx.storage ?? local();
  // A run under way keeps the key it began with: stop it, so nothing more goes with that key (SEC-2).
  stopModelRuns();
  try {
    // The ledger opened loads this worker's keyring: whether the key is sealed, and with what (header).
    await ctx.db();
    if (isLocked()) {
      log.info('byo.save_locked');
      return { ok: false, code: 'failed' };
    }
    const { sealing, current } = keyring();
    const key = sealing && current !== undefined ? sealText(current, BYO_AAD, message.key) : message.key;
    await closeStorage(storage);
    await storage.set({ [STORAGE_KEYS.BYO_KEY]: key, [STORAGE_KEYS.BYO_VENDOR]: message.vendor });
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
