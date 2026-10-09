/**
 * The options page's settings (sprint_4 4.5): the retention window (ledger meta), which page readers are off
 * (`chrome.storage.local`, src/background/readers.ts) and each observer's last health report (the ledger). They are
 * read when a section opens and again when the service worker announces a change to meta or adapter health, or the
 * readers' choice changes. Every change goes to the service worker (`retention.save`, `reader.toggle`, `ledger.wipe`):
 * pages never write. A read that fails is said and logged (Hard Rule 6).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { readersOff } from '../../src/background/readers';
import type {
  LedgerWipeMessage,
  ReaderToggleMessage,
  RetentionSaveMessage,
  SettingResult,
} from '../../src/bus/messages';
import { sendSetting } from '../../src/bus/send';
import { type ReaderId, STORAGE_KEYS } from '../../src/config';
import type { AdapterHealth } from '../../src/ledger/types';
import type { RetentionChoice } from '../../src/ledger/settings';
import { log } from '../../src/log';
import { loadHealth, loadRetentionDays, onLedgerChanged } from '../../src/ui/data';

export interface SettingsView {
  readonly retentionDays: RetentionChoice;
  readonly readersOff: ReadonlySet<ReaderId>;
  readonly health: readonly AdapterHealth[];
}

export type SettingCommand = RetentionSaveMessage | ReaderToggleMessage | LedgerWipeMessage;

export interface SettingsSources {
  readonly load: () => Promise<SettingsView>;
  readonly send: (command: SettingCommand) => Promise<SettingResult>;
  /** Calls `onChange` when a setting may have changed; returns how to stop. */
  readonly subscribe: (onChange: () => void) => () => void;
}

/** Calls `onChange` when the readers' choice changes in `chrome.storage.local`. */
function onReadersChanged(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>): void => {
    if (Object.hasOwn(changes, STORAGE_KEYS.READERS_OFF)) onChange();
  };
  browser.storage.local.onChanged.addListener(listener);
  return () => {
    browser.storage.local.onChanged.removeListener(listener);
  };
}

export const LIVE_SETTINGS: SettingsSources = {
  load: async () => ({
    retentionDays: await loadRetentionDays(),
    readersOff: await readersOff(browser.storage.local),
    health: await loadHealth(),
  }),
  send: sendSetting,
  subscribe: (onChange) => {
    const stopLedger = onLedgerChanged(['meta', 'adapterHealth'], onChange);
    const stopReaders = onReadersChanged(onChange);
    return () => {
      stopLedger();
      stopReaders();
    };
  },
};

export type SettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly view: SettingsView };

export function useSettings(sources: SettingsSources = LIVE_SETTINGS): SettingsState {
  const [state, setState] = useState<SettingsState>({ status: 'loading' });
  const read = useMemo(
    () => () => {
      sources.load().then(
        (view) => {
          setState({ status: 'ready', view });
        },
        (error: unknown) => {
          log.error('options.settings_read_failed', { error });
          setState({ status: 'failed' });
        },
      );
    },
    [sources],
  );
  useEffect(() => {
    read();
    return sources.subscribe(read);
  }, [read, sources]);
  return state;
}
