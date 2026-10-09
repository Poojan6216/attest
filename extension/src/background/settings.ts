/**
 * The person's settings in the service worker (sprint_4 4.5): the retention window (`retention.save`) and Delete all
 * data (`ledger.wipe`), each sent by the options page only. Which readers run is ./readers.ts.
 *
 * Delete all data deletes everything Attest keeps in this browser, and keeps no copy anywhere (Hard Rules 1, 2). The
 * service worker closes its own connection to the ledger and deletes the database: Chrome asks every other connection
 * (each open page's) to close, Dexie closes it, and it opens again, empty, at its next read; nothing can be stored in
 * the old database meanwhile, since an open waits for the delete. Then `chrome.storage.local` is cleared: the install
 * id, the feature flags and which readers are off (a new id is made when one is next needed, and every reader is on
 * again, so the registrations follow: ./readers.ts). Every table is announced changed, so open pages read again. Attest
 * keeps running: its alarms stay, and a page opened later is read again. An optional permission the person granted
 * (away detection) is theirs to remove in Chrome; it holds no data.
 */
import { browser } from 'wxt/browser';

import { LedgerTable, type RetentionSaveMessage, type SettingResult } from '../bus/messages';
import type { LedgerDb } from '../ledger/db';
import { saveRetentionDays } from '../ledger/settings';
import { deleteLedger } from '../ledger/shared';
import { log } from '../log';

export interface SettingsContext {
  readonly db: () => Promise<LedgerDb>;
  readonly notify: (tables: readonly LedgerTable[]) => void;
}

/** Saves the retention window; the next daily purge keeps that many days. */
export async function onRetentionSave(
  ctx: SettingsContext,
  message: RetentionSaveMessage,
): Promise<SettingResult> {
  try {
    await saveRetentionDays(await ctx.db(), message.days);
  } catch (error) {
    log.error('retention.save_failed', { error });
    return { ok: false, code: 'failed' };
  }
  log.info('retention.saved', { days: message.days });
  ctx.notify(['meta']);
  return { ok: true };
}

export interface WipeDeps {
  readonly notify: (tables: readonly LedgerTable[]) => void;
  /** Clears `chrome.storage.local`. */
  readonly clearStorage?: () => Promise<void>;
  /** Brings the readers' registrations back in line once their choice is gone (every reader on). */
  readonly syncReaders: () => Promise<void>;
}

/** Deletes every Attest datum in this browser (header). */
export async function onLedgerWipe(deps: WipeDeps): Promise<SettingResult> {
  try {
    await deleteLedger();
    await (deps.clearStorage ?? (() => browser.storage.local.clear()))();
  } catch (error) {
    log.error('ledger.wipe_failed', { error });
    return { ok: false, code: 'failed' };
  }
  log.warn('ledger.wiped');
  deps.notify(LedgerTable.options);
  await deps.syncReaders().catch((error: unknown) => {
    log.error('readers.sync_failed', { error });
  });
  return { ok: true };
}
