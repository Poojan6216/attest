/**
 * `runtime.onInstalled` handler. Registered synchronously in `entrypoints/background.ts` (MV3); the work
 * lives here so the entrypoint stays thin.
 *
 * On install and on update it makes sure the install id exists, (re)creates the alarms, and settles the page readers:
 * an older profile's choices moved into the ledger (./consent-move.ts), then the registrations brought in line
 * (./readers.ts; sprint_4 close, tech review TECH-6: never at every start of the worker). The three are independent: a
 * storage failure under the install id must not leave the extension without a scheduler or its readers, and each
 * failure is reported under its own event. Browser updates and shared-module updates change nothing Attest owns, so
 * they are skipped (the alarms keep their countdown).
 */
import { z } from 'zod';

import { browser } from 'wxt/browser';

import { ensureInstallId } from '../ledger/install-id';
import { getLedger } from '../ledger/shared';
import { log } from '../log';
import { resetAlarms } from './alarms';
import { moveStoredChoices } from './consent-move';
import { closeStorage } from './byo';
import { syncReaders } from './readers';

export const INSTALL_REASONS = ['install', 'update', 'chrome_update', 'shared_module_update'] as const;

/** The fields Attest reads from Chrome's `InstalledDetails`. Unknown fields are ignored, not trusted. */
const InstalledDetails = z.object({ reason: z.enum(INSTALL_REASONS) });

export type InstallOutcome = 'ensured' | 'skipped' | 'ignored';

/** True for the two reasons that change what Attest owns: a fresh install and an update of Attest. */
function ownsChange(details: unknown): boolean {
  const parsed = InstalledDetails.safeParse(details);
  return parsed.success && (parsed.data.reason === 'install' || parsed.data.reason === 'update');
}

/**
 * Parses the event at the boundary, then ensures the install id on `install` and `update`.
 * Returns what it did; storage failures reject with `InstallIdError` for the caller to log.
 */
export async function handleInstalled(details: unknown): Promise<InstallOutcome> {
  const parsed = InstalledDetails.safeParse(details);
  if (!parsed.success) {
    log.warn('install.details_invalid', { issues: parsed.error.issues.length });
    return 'ignored';
  }
  const { reason } = parsed.data;
  if (reason !== 'install' && reason !== 'update') {
    log.debug('install.skipped', { reason });
    return 'skipped';
  }
  await ensureInstallId();
  log.info('install.handled', { reason });
  return 'ensured';
}

/**
 * The readers settled after an install or an update (header): the old choices moved, then the registrations synced. A
 * move that fails is logged on its own (`consent.move_failed`), and the registrations still follow what the ledger holds.
 */
export async function settleReaders(sync: () => Promise<void> = syncReaders): Promise<void> {
  try {
    await moveStoredChoices(await getLedger(), browser.storage.local);
  } catch (error) {
    log.error('consent.move_failed', { error });
  }
  await sync();
}

/**
 * The whole onInstalled job. Never rejects: the install id, the alarms, the readers and the closing of
 * `chrome.storage.local` to content scripts (./byo.ts, sprint_5 5.3) are settled independently, and each failure is
 * logged under its own event (`install.failed`, `alarm.reset_failed`, `readers.sync_failed`, `storage.close_failed`).
 */
export async function onInstalled(details: unknown): Promise<void> {
  const owns = ownsChange(details);
  const [installId, alarms, readers, closed] = await Promise.allSettled([
    handleInstalled(details),
    owns ? resetAlarms() : Promise.resolve(),
    owns ? settleReaders() : Promise.resolve(),
    owns ? closeStorage() : Promise.resolve(),
  ]);
  if (installId.status === 'rejected') log.error('install.failed', { error: installId.reason });
  if (alarms.status === 'rejected') log.error('alarm.reset_failed', { error: alarms.reason });
  if (readers.status === 'rejected') log.error('readers.sync_failed', { error: readers.reason });
  if (closed.status === 'rejected') log.error('storage.close_failed', { error: closed.reason });
}
