import { useInstallId } from '../use-install-id';
import { InstallIdValue } from './InstallIdValue';
import { ResetInstallIdControl } from './ResetInstallIdControl';

/** The install id: what it is, what uses it, its current value, and the reset. */
export function InstallIdPanel() {
  const { view, reset } = useInstallId();
  return (
    <div role="group" aria-labelledby="install-id-heading" class="space-y-3">
      <h3 id="install-id-heading" class="font-semibold">
        Install id
      </h3>
      <p>
        A random id, not made from anything about you, your accounts or this device. Only the anonymous usage
        numbers use it, and only while you have them on: each day’s numbers carry it. After a reset, the
        reports before and after it no longer share an id.
      </p>
      <InstallIdValue view={view} />
      <ResetInstallIdControl onReset={reset} />
    </div>
  );
}
