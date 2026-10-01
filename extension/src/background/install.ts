/**
 * `runtime.onInstalled` handler. Registered synchronously in `entrypoints/background.ts` (MV3); the work
 * lives here so the entrypoint stays thin.
 *
 * On install and on update it makes sure the install id exists. Browser updates and shared-module updates
 * change nothing Attest owns, so they are skipped.
 */
import { z } from 'zod';

import { ensureInstallId } from '../ledger/install-id';
import { log } from '../log';

/** The fields Attest reads from Chrome's `InstalledDetails`. Unknown fields are ignored, not trusted. */
const InstalledDetails = z.object({
  reason: z.enum(['install', 'update', 'chrome_update', 'shared_module_update']),
});

export type InstallOutcome = 'ensured' | 'skipped' | 'ignored';

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
