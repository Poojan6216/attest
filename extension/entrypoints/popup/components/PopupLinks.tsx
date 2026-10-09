import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';

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
    <nav aria-label="Attest pages" class="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={openTimeline}>
        Open timeline
      </Button>
      <Button variant="secondary" onClick={openDigest}>
        Weekly digest
      </Button>
      <Button variant="secondary" onClick={openSettings}>
        Open settings
      </Button>
      {failed ? (
        <p role="alert" class="w-full text-xs text-grade-not-found-fg">
          Chrome did not open it. Try again.
        </p>
      ) : null}
    </nav>
  );
}
