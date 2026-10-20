import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { log } from '../../../src/log';

/** The id of the window the popup belongs to, once Chrome has said it; null until then, or when it cannot. */
function useWindowId(): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    browser.windows.getCurrent().then(
      (current) => {
        setId(current.id ?? null);
      },
      (error: unknown) => {
        log.warn('popup.window_unknown', { error });
      },
    );
  }, []);
  return id;
}

/** A quiet text button in the popup's footer: the receipts, not the navigation, lead (agents/ux_engineer.md rule 1). */
const LINK =
  'rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-skeleton hover:text-ink focus-visible:outline focus-visible:outline-2';

/**
 * The popup's ways on (sprint_4 4.2, 4.7): the side panel, for the timeline and each receipt's detail; the weekly
 * digest, in a tab; and the settings. Chrome opens a side panel only in answer to a click, so the click calls it at
 * once, in the window read when the popup opened. A refusal is said and logged (Hard Rule 6).
 */
export function PopupLinks() {
  const windowId = useWindowId();
  const [failed, setFailed] = useState(false);
  const openTimeline = () => {
    if (windowId === null) {
      setFailed(true);
      return;
    }
    browser.sidePanel.open({ windowId }).then(
      () => {
        window.close();
      },
      (error: unknown) => {
        log.warn('popup.side_panel_failed', { error });
        setFailed(true);
      },
    );
  };
  const openDigest = () => {
    browser.tabs.create({ url: browser.runtime.getURL('/digest.html') }).then(
      () => {
        window.close();
      },
      (error: unknown) => {
        log.warn('popup.digest_failed', { error });
        setFailed(true);
      },
    );
  };
  const openSettings = () => {
    browser.runtime.openOptionsPage().then(
      () => {
        window.close();
      },
      (error: unknown) => {
        log.warn('popup.options_failed', { error });
        setFailed(true);
      },
    );
  };
  return (
    <nav aria-label="Attest pages" class="flex flex-wrap items-center gap-1">
      <button type="button" class={LINK} aria-label="Open timeline" onClick={openTimeline}>
        Open timeline
      </button>
      <button type="button" class={LINK} aria-label="Open weekly digest" onClick={openDigest}>
        Open digest
      </button>
      <button type="button" class={LINK} aria-label="Open settings" onClick={openSettings}>
        Open settings
      </button>
      {failed ? (
        <p role="alert" class="w-full text-xs text-error-fg">
          Chrome did not open it. Try again.
        </p>
      ) : null}
    </nav>
  );
}
