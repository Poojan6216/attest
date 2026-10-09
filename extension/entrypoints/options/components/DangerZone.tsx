import { sendSetting } from '../../../src/bus/send';
import { DeleteAllControl } from './DeleteAllControl';
import { InstallIdPanel } from './InstallIdPanel';
import { Section } from './Section';
import type { SettingCommand } from '../use-settings';

export interface DangerZoneProps {
  /** Sends Delete all data to the service worker; the bus when absent. */
  readonly send?: (command: SettingCommand) => ReturnType<typeof sendSetting>;
}

/** Actions that cannot be undone. Each one asks before it acts. */
export function DangerZone({ send = sendSetting }: DangerZoneProps) {
  return (
    <Section id="danger-zone" tone="danger">
      <InstallIdPanel />
      <div
        role="group"
        aria-labelledby="delete-all-heading"
        class="space-y-3 border-t border-neutral-300 pt-4 dark:border-neutral-700"
      >
        <h3 id="delete-all-heading" class="font-semibold">
          Delete all Attest data
        </h3>
        <p>
          Delete everything Attest keeps in this browser without uninstalling it: every receipt, the facts
          behind them, the grants, the install id and the settings. Attest keeps running and reads the pages
          you open from then on.
        </p>
        <DeleteAllControl wipe={() => send({ type: 'ledger.wipe' })} />
        <p>Uninstalling Attest also removes everything it stored.</p>
      </div>
    </Section>
  );
}
