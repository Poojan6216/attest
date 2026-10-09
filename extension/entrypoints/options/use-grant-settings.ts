/**
 * The options page's Grants (sprint_4 4.4): every agent's grant and alert mute, read from the ledger when the section
 * opens and again when the service worker announces a change to grants or meta, and the save, which goes to the service
 * worker (`grant.save`): pages never write the ledger. A read that fails is said and logged (Hard Rule 6).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';

import type { GrantSaveMessage, GrantSaveResult, LedgerTable } from '../../src/bus/messages';
import { sendGrant } from '../../src/bus/send';
import { log } from '../../src/log';
import { type GrantSettings, loadGrantSettings, onLedgerChanged } from '../../src/ui/data';

export interface GrantSources {
  readonly load: () => Promise<GrantSettings>;
  readonly save: (grant: GrantSaveMessage['grant'], alertsMuted: boolean) => Promise<GrantSaveResult>;
  readonly subscribe: (tables: readonly LedgerTable[], onChange: () => void) => () => void;
}

export const LIVE_GRANTS: GrantSources = {
  load: loadGrantSettings,
  save: sendGrant,
  subscribe: onLedgerChanged,
};

export type GrantSettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly settings: GrantSettings };

export function useGrantSettings(sources: GrantSources = LIVE_GRANTS): GrantSettingsState {
  const [state, setState] = useState<GrantSettingsState>({ status: 'loading' });
  const read = useMemo(
    () => () => {
      sources.load().then(
        (settings) => {
          setState({ status: 'ready', settings });
        },
        (error: unknown) => {
          log.error('options.grants_read_failed', { error });
          setState({ status: 'failed' });
        },
      );
    },
    [sources],
  );
  useEffect(() => {
    read();
    return sources.subscribe(['grants', 'meta'], read);
  }, [read, sources]);
  return state;
}
