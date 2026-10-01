/**
 * `runtime.onInstalled` handler. Registered synchronously in `entrypoints/background.ts` (MV3); the work
 * lives here so the entrypoint stays thin.
 *
 * On install and on update it makes sure the install id exists and (re)creates the alarms. The two are
 * independent: a storage failure under the install id must not leave the extension without a scheduler,
 * and an alarm failure must not be reported as an install-id failure. Browser updates and shared-module
 * updates change nothing Attest owns, so they are skipped (the alarms keep their countdown).
 */
import { z } from 'zod';

import { ensureInstallId } from '../ledger/install-id';
import { log } from '../log';
import { resetAlarms } from './alarms';

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
 * The whole onInstalled job. Never rejects: the install id and the alarms are settled independently and
 * each failure is logged under its own event (`install.failed`, `alarm.reset_failed`).
 */
export async function onInstalled(details: unknown): Promise<void> {
  const [installId, alarms] = await Promise.allSettled([
    handleInstalled(details),
    ownsChange(details) ? resetAlarms() : Promise.resolve(),
  ]);
  if (installId.status === 'rejected') log.error('install.failed', { error: installId.reason });
  if (alarms.status === 'rejected') log.error('alarm.reset_failed', { error: alarms.reason });
}
