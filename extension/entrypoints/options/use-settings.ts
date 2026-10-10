/**
 * The options page's settings (sprint_4 4.5): the retention window, which page readers are off, and the flags (the
 * Gmail auto-check, 4.9; the on-device model, the person's own key and the usage numbers, sprint_5 5.2, 5.3, 5.7), all
 * ledger meta (src/ledger/settings.ts, src/ledger/consent.ts); the saved key's vendor, never the key
 * (src/ui/privacy-data.ts); and each observer's last health report. They are read when a section opens and again when
 * the service worker announces a change to meta or adapter health. Every change goes to the service worker
 * (`retention.save`, `reader.toggle`, `flag.set`, `byo.save`, `byo.forget`, `ledger.wipe`): pages never write. A read
 * that fails is said and logged (Hard Rule 6).
 */
import type {
  ByoForgetMessage,
  ByoSaveMessage,
  FlagSetMessage,
  LedgerWipeMessage,
  ReaderToggleMessage,
  RetentionSaveMessage,
  SettingResult,
} from '../../src/bus/messages';
import { sendSetting } from '../../src/bus/send';
import type { ByoVendor, ReaderId } from '../../src/config';
import type { AdapterHealth } from '../../src/ledger/types';
import type { RetentionChoice } from '../../src/ledger/settings';
import { log } from '../../src/log';
import { onLedgerChanged } from '../../src/ui/data';
import { loadByoVendor, loadConsent, loadHealth, loadRetentionDays } from '../../src/ui/settings-data';
import { useLedgerRead } from '../../src/ui/use-ledger-read';

export interface SettingsView {
  readonly retentionDays: RetentionChoice;
  readonly readersOff: ReadonlySet<ReaderId>;
  /** Whether the Gmail auto-check is on (flag ATTEST_AUTO_CHECK_GMAIL). */
  readonly autoCheckGmail: boolean;
  /** Whether Chrome's on-device model may score candidates (flag ATTEST_MODEL; sprint_5 5.2). */
  readonly modelOn: boolean;
  /** Whether the person's own key may score candidates (flag ATTEST_MODEL_BYO; sprint_5 5.3). */
  readonly modelByoOn: boolean;
  /** The vendor of the person's saved key, or null when none is saved; never the key (src/background/byo.ts). */
  readonly byoVendor: ByoVendor | null;
  /** Whether the opt-in telemetry is on (flag ATTEST_TELEMETRY; sprint_5 5.7). */
  readonly telemetryOn: boolean;
  readonly health: readonly AdapterHealth[];
}

export type SettingCommand =
  | RetentionSaveMessage
  | ReaderToggleMessage
  | FlagSetMessage
  | ByoSaveMessage
  | ByoForgetMessage
  | LedgerWipeMessage;

export interface SettingsSources {
  readonly load: () => Promise<SettingsView>;
  readonly send: (command: SettingCommand) => Promise<SettingResult>;
  /** Calls `onChange` when a setting may have changed; returns how to stop. */
  readonly subscribe: (onChange: () => void) => () => void;
}

export const LIVE_SETTINGS: SettingsSources = {
  load: async () => {
    const consent = await loadConsent();
    return {
      retentionDays: await loadRetentionDays(),
      readersOff: consent.readersOff,
      autoCheckGmail: consent.flags.ATTEST_AUTO_CHECK_GMAIL,
      modelOn: consent.flags.ATTEST_MODEL,
      modelByoOn: consent.flags.ATTEST_MODEL_BYO,
      byoVendor: await loadByoVendor(),
      telemetryOn: consent.flags.ATTEST_TELEMETRY,
      health: await loadHealth(),
    };
  },
  send: sendSetting,
  subscribe: (onChange) => onLedgerChanged(['meta', 'adapterHealth'], onChange),
};

export type SettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'locked' }
  | { readonly status: 'ready'; readonly view: SettingsView };

const logReadFailed = (error: unknown): void => {
  log.error('options.settings_read_failed', { error });
};

/** The settings, read in order (src/ui/use-ledger-read.ts). */
export function useSettings(sources: SettingsSources = LIVE_SETTINGS): SettingsState {
  const read = useLedgerRead(sources.load, sources.subscribe, logReadFailed);
  return read.status === 'ready' ? { status: 'ready', view: read.value } : read;
}
