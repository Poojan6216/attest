import { useCallback, useEffect, useState } from 'preact/hooks';

import {
  type InstallId,
  onInstallIdChanged,
  readInstallId,
  resetInstallId,
} from '../../src/ledger/install-id';
import { log } from '../../src/log';

export type InstallIdView =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly id: InstallId }
  /** Another context removed the id or stored something that is not one. The old id is no longer shown. */
  | { readonly status: 'missing' }
  | { readonly status: 'error' };

export interface UseInstallId {
  readonly view: InstallIdView;
  /** Resets the id. Resolves `true` on success, `false` when storage failed (already logged). */
  readonly reset: () => Promise<boolean>;
}

/**
 * Reads the install id, keeps it in sync with changes from other contexts (another options tab, the
 * service worker), and exposes the reset action.
 *
 * A change to a value that is not a valid id shows `missing` rather than the old id, which would no longer
 * be true. The page never makes an id (Sprint 5 close, tech review TECH-1; Decisions [5.7]): it reads the stored one,
 * `missing` when there is none, so a page never recreates an id removed elsewhere, and two open tabs never race to.
 * The person's reset makes a new one; the service worker makes one at install and when it sends the usage numbers.
 */
export function useInstallId(): UseInstallId {
  const [view, setView] = useState<InstallIdView>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let changedElsewhere = false;
    const unsubscribe = onInstallIdChanged((id) => {
      if (!active) return;
      changedElsewhere = true;
      setView(id === null ? { status: 'missing' } : { status: 'ready', id });
    });
    readInstallId()
      .then((id) => {
        if (active && !changedElsewhere)
          setView(id === null ? { status: 'missing' } : { status: 'ready', id });
      })
      .catch((error: unknown) => {
        log.error('options.install_id_read_failed', { error });
        if (active && !changedElsewhere) setView({ status: 'error' });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const reset = useCallback(async (): Promise<boolean> => {
    try {
      const id = await resetInstallId();
      setView({ status: 'ready', id });
      return true;
    } catch (error) {
      log.error('options.install_id_reset_failed', { error });
      return false;
    }
  }, []);

  return { view, reset };
}
