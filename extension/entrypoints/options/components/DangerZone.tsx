import { InstallIdPanel } from './InstallIdPanel';
import { LaterVersionNote } from './LaterVersionNote';
import { Section } from './Section';

/** Actions that cannot be undone. Each one asks before it acts. */
export function DangerZone() {
  return (
    <Section id="danger-zone" tone="danger">
      <InstallIdPanel />
      <div class="space-y-3 border-t border-neutral-300 pt-4 dark:border-neutral-700">
        <h3 class="font-semibold">Delete all Attest data</h3>
        <p>Delete everything Attest keeps in this browser without uninstalling it.</p>
        <LaterVersionNote />
        <p>Uninstalling Attest also removes everything it stored.</p>
      </div>
    </Section>
  );
}
