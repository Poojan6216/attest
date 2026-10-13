/**
 * The person's settings in the service worker (sprint_4 4.5): the retention window (`retention.save`) and Delete all
 * data (`ledger.wipe`), each sent by the options page only. Which readers run is ./readers.ts.
 *
 * Delete all data deletes everything Attest keeps in this browser, and keeps no copy anywhere (Hard Rules 1, 2). The
 * service worker reads which readers are off, forgets the keys of an encrypted ledger (sprint_6 6.5: nothing is left to
 * unlock), closes its own connection to the ledger and deletes the database: Chrome
 * asks every other connection (each open page's) to close, Dexie closes it, and it opens again, empty, at its next
 * read; nothing can be stored in the old database meanwhile, since an open waits for the delete. Then
 * `chrome.storage.local` (the install id; a new one is made when next needed) and `chrome.storage.session` (a receipt a
 * clicked alert asked to open, the away session's mark) are cleared, and every notification Attest shows is taken down.
 * The one thing kept is a choice, never data: each reader the person turned off is written off again into the new
 * ledger, so a wipe never makes Attest read more (sprint_4 close, security review SEC-6; a choice that cannot be read
 * reads as every reader off). Check Gmail for me, a setting like the rest, is off again. Every table is announced
 * changed, so open pages read again. Attest keeps running: its alarms stay, and a page opened later is read again. An
 * optional permission the person granted (away detection) is theirs to remove in Chrome; it holds no data.
 */
import { browser } from 'wxt/browser';

import { LedgerTable, type RetentionSaveMessage, type SettingResult } from '../bus/messages';
import { type ReaderId, READERS } from '../config';
import { readersOff, saveReaderOff } from '../ledger/consent';
import type { LedgerDb } from '../ledger/db';
import { deleteAndCompact, deleteLedgerCopy, flushChromeFiles } from '../ledger/rebuild';
import { saveRetentionDays } from '../ledger/settings';
import { deleteLedger, getLedger } from '../ledger/shared';
import { log } from '../log';
import { forgetKeys } from './crypto';

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
  /** Clears `chrome.storage.local` and `chrome.storage.session`. */
  readonly clearStorage?: () => Promise<void>;
  /** Takes down every notification Attest shows. */
  readonly clearNotifications?: () => Promise<void>;
  /** Brings the readers' registrations back in line with the choice kept (./readers.ts). */
  readonly syncReaders: () => Promise<void>;
}

/** Chrome's own: both storage areas emptied. */
async function clearBrowserStorage(): Promise<void> {
  await browser.storage.local.clear();
  await browser.storage.session.clear();
}

/** Chrome's own: each of Attest's notifications cleared. */
async function clearBrowserNotifications(): Promise<void> {
  const shown = await browser.notifications.getAll();
  await Promise.all(Object.keys(shown).map((id) => browser.notifications.clear(id)));
}

/** The readers that are off, to keep across the wipe; every reader when the choice cannot be read (logged). */
async function readersToKeepOff(): Promise<ReadonlySet<ReaderId>> {
  try {
    return await readersOff(await getLedger());
  } catch (error) {
    log.error('ledger.wipe_choice_unread', { error });
    return new Set(READERS);
  }
}

/** Deletes every Attest datum in this browser, keeping only which readers are off (header). */
export async function onLedgerWipe(deps: WipeDeps): Promise<SettingResult> {
  try {
    const off = await readersToKeepOff();
    await forgetKeys();
    // Chrome's files keep a deleted row until a compaction rewrites them (Sprint 6 close, security review SEC-1): the
    // deletions are made so that Chrome compacts them away, and a rebuild's copy goes too (src/ledger/rebuild.ts).
    await deleteAndCompact(async () => {
      await deleteLedger();
      await deleteLedgerCopy();
    });
    await flushChromeFiles();
    await (deps.clearStorage ?? clearBrowserStorage)();
    const db = await getLedger();
    for (const reader of off) await saveReaderOff(db, reader, true);
  } catch (error) {
    log.error('ledger.wipe_failed', { error });
    return { ok: false, code: 'failed' };
  }
  log.warn('ledger.wiped');
  deps.notify(LedgerTable.options);
  await (deps.clearNotifications ?? clearBrowserNotifications)().catch((error: unknown) => {
    log.error('ledger.wipe_notifications_failed', { error });
  });
  await deps.syncReaders().catch((error: unknown) => {
    log.error('readers.sync_failed', { error });
  });
  return { ok: true };
}
