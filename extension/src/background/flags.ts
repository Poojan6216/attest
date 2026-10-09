/**
 * The feature flags (src/config.ts FEATURE_FLAGS; sprint_4 4.9). Each is off until the person turns it on. The choices
 * are kept in `chrome.storage.local` under STORAGE_KEYS.FLAGS, as the flags the person set, each true or false; a flag
 * never set is its default (FEATURE_FLAG_DEFAULTS, every one off). A stored value that is not such a record reads as
 * the defaults (logged): a choice that cannot be read is never taken as consent. Only the service worker writes it
 * (`flag.set`, which the options page sends for the flags in SETTABLE_FLAGS); the service worker and the options page
 * read it here. Delete all data clears it (./settings.ts).
 */
import { z } from 'zod';

import type { FlagSetMessage, SettingResult } from '../bus/messages';
import { FEATURE_FLAG_DEFAULTS, FEATURE_FLAGS, type FeatureFlag, STORAGE_KEYS } from '../config';
import { log } from '../log';

/** The part of `chrome.storage.local` the flags use. */
export interface FlagStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** What is stored: the flags the person set, each on or off. Any other key, or a value that is not true or false, fails. */
const StoredFlags = z.partialRecord(z.enum(FEATURE_FLAGS), z.boolean());

export type Flags = Readonly<Record<FeatureFlag, boolean>>;

/** The flags as the person set them, or none when nothing valid is stored (logged). */
async function storedFlags(storage: FlagStorage): Promise<Partial<Record<FeatureFlag, boolean>>> {
  const stored = (await storage.get(STORAGE_KEYS.FLAGS))[STORAGE_KEYS.FLAGS];
  if (stored === undefined) return {};
  const parsed = StoredFlags.safeParse(stored);
  if (parsed.success) return parsed.data;
  log.error('flags.invalid');
  return {};
}

/** Every flag: as the person set it, else its default (header). */
export async function readFlags(storage: FlagStorage): Promise<Flags> {
  return Object.freeze({ ...FEATURE_FLAG_DEFAULTS, ...(await storedFlags(storage)) });
}

/** Turns `message.flag` on or off: stored beside the other flags the person set (a record that could not be read is replaced). */
export async function onFlagSet(message: FlagSetMessage, storage: FlagStorage): Promise<SettingResult> {
  try {
    const flags = { ...(await storedFlags(storage)), [message.flag]: message.on };
    await storage.set({ [STORAGE_KEYS.FLAGS]: flags });
  } catch (error) {
    log.error('flags.set_failed', { flag: message.flag, error });
    return { ok: false, code: 'failed' };
  }
  log.info('flags.set', { flag: message.flag, on: message.on });
  return { ok: true };
}
