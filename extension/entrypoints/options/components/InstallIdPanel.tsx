import { useInstallId } from '../use-install-id';
import { InstallIdValue } from './InstallIdValue';
import { ResetInstallIdControl } from './ResetInstallIdControl';

/** The install id: what it is, what uses it, its current value, and the reset. */
export function InstallIdPanel() {
  const { view, reset } = useInstallId();
  return (
    <div class="space-y-3">
      <h3 class="font-semibold">Install id</h3>
      <p>
        A random id, not made from anything about you, your accounts or this device. Only the opt-in telemetry
        in a later version uses it. Resetting it means past and future reports can no longer be linked to each
        other.
      </p>
      <InstallIdValue view={view} />
      <ResetInstallIdControl onReset={reset} />
    </div>
  );
}
