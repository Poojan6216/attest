import { Skeleton } from '../../../src/ui/Skeleton';
import { useLoaded } from '../../../src/ui/use-loaded';
import { type PopupSources, usePopupView } from '../use-popup-view';
import { PopupLinks } from './PopupLinks';
import { Today } from './Today';
import type { PrivacySources } from '../../../src/ui/privacy-data';
import { PrivacyLine } from '../../../src/ui/PrivacyLine';

export interface PopupProps {
  /** Where the popup reads from; the ledger and the bus when absent. */
  readonly sources?: PopupSources;
  /** Where the privacy line reads the person's choices; the ledger and storage when absent. */
  readonly privacy?: PrivacySources;
}

/**
 * The popup (sprint_4 4.2): today's receipts in one glance, with what Attest has checked above them. Skeleton rows
 * while the ledger is read; a read that fails says so; an encrypted ledger that is locked asks for its passphrase
 * (sprint_6 6.5), with a prompt loaded only then (tech review TECH-1). The privacy line closes it, as since Sprint 0.
 */
/** The unlock prompt, loaded when the ledger is first found locked (tech review TECH-1). */
const loadLockedNotice = () => import('../../../src/ui/LockedNotice');

export function Popup({ sources, privacy }: PopupProps) {
  const state = usePopupView(sources);
  const notice = useLoaded(state.status === 'locked', loadLockedNotice);
  return (
    <main class="w-[22rem] space-y-3 bg-surface p-gutter text-sm text-ink">
      <header>
        <h1 class="text-base font-semibold">Attest</h1>
      </header>
      {state.status === 'loading' ? <Skeleton rows={4} label="Loading today's receipts" /> : null}
      {state.status === 'failed' ? (
        <p role="alert" class="text-error-fg">
          Attest could not read its records. Close the popup and open it again.
        </p>
      ) : null}
      {state.status === 'locked' && notice !== undefined ? (
        <notice.LockedNotice toShow="see today's receipts" />
      ) : null}
      {state.status === 'ready' ? (
        <Today view={state.view} nowMs={state.nowMs} userAgent={navigator.userAgent} />
      ) : null}
      <footer class="space-y-1 border-t border-rule pt-2">
        <PopupLinks />
        <PrivacyLine sources={privacy} class="text-xs text-ink-muted" />
      </footer>
    </main>
  );
}
