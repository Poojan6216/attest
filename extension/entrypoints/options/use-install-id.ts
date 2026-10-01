import { useCallback, useEffect, useState } from 'preact/hooks';

import {
  getInstallId,
  type InstallId,
  onInstallIdChanged,
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
 * be true. The listener never writes: two open tabs must not race to regenerate the id. The next read or a
 * reset creates a new one.
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
    getInstallId()
      .then((id) => {
        if (active && !changedElsewhere) setView({ status: 'ready', id });
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
