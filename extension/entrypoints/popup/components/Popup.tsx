import { Skeleton } from '../../../src/ui/Skeleton';
import { type PopupSources, usePopupView } from '../use-popup-view';
import { PopupLinks } from './PopupLinks';
import { Today } from './Today';

export interface PopupProps {
  /** Where the popup reads from; the ledger and the bus when absent. */
  readonly sources?: PopupSources;
}

/**
 * The popup (sprint_4 4.2): today's receipts in one glance, with what Attest has checked above them. Skeleton rows
 * while the ledger is read; a read that fails says so. The privacy line closes it, as since Sprint 0.
 */
export function Popup({ sources }: PopupProps) {
  const state = usePopupView(sources);
  return (
    <main class="w-[22rem] space-y-3 bg-surface p-gutter text-sm text-ink">
      <header class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-base font-semibold">Attest</h1>
        <PopupLinks />
      </header>
      {state.status === 'loading' ? <Skeleton rows={4} label="Loading today's receipts" /> : null}
      {state.status === 'failed' ? (
        <p role="alert" class="text-error-fg">
          Attest could not read its records. Close the popup and open it again.
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <Today view={state.view} nowMs={state.nowMs} userAgent={navigator.userAgent} />
      ) : null}
      <p class="text-xs text-ink-muted">Nothing leaves your browser.</p>
    </main>
  );
}
