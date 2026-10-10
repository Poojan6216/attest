/**
 * The options page's Grants (sprint_4 4.4): every agent's grant and alert mute, read from the ledger when the section
 * opens and again when the service worker announces a change to grants or meta, and the save, which goes to the service
 * worker (`grant.save`): pages never write the ledger. A read that fails is said and logged (Hard Rule 6).
 */
import { useCallback } from 'preact/hooks';

import type { GrantSaveMessage, GrantSaveResult, LedgerTable } from '../../src/bus/messages';
import { sendGrant } from '../../src/bus/send';
import { log } from '../../src/log';
import { onLedgerChanged } from '../../src/ui/data';
import { type GrantSettings, loadGrantSettings } from '../../src/ui/settings-data';
import { useLedgerRead } from '../../src/ui/use-ledger-read';

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

const logReadFailed = (error: unknown): void => {
  log.error('options.grants_read_failed', { error });
};

/** The grant settings, read in order, again when grants or meta change (src/ui/use-ledger-read.ts). */
export function useGrantSettings(sources: GrantSources = LIVE_GRANTS): GrantSettingsState {
  const subscribe = useCallback(
    (onChange: () => void) => sources.subscribe(['grants', 'meta'], onChange),
    [sources],
  );
  const read = useLedgerRead(sources.load, subscribe, logReadFailed);
  return read.status === 'ready' ? { status: 'ready', settings: read.value } : read;
}
