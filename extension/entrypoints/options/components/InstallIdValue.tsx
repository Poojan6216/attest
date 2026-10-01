import type { InstallIdView } from '../use-install-id';

export interface InstallIdValueProps {
  readonly view: InstallIdView;
}

/** Shows the current install id so the user can see it change after a reset. */
export function InstallIdValue({ view }: InstallIdValueProps) {
  return (
    <dl>
      <dt class="text-neutral-600 dark:text-neutral-400">Current install id</dt>
      <dd class="mt-1">
        {view.status === 'ready' ? (
          <code id="install-id-value" class="font-mono text-sm break-all">
            {view.id}
          </code>
        ) : null}
        {view.status === 'loading' ? <span>Loading…</span> : null}
        {view.status === 'missing' ? (
          <span>No valid install id is stored. Reset it to create a new one.</span>
        ) : null}
        {view.status === 'error' ? <span>Could not read the install id.</span> : null}
      </dd>
    </dl>
  );
}
