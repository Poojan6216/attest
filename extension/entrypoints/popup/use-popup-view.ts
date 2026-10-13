/**
 * The popup's data (sprint_4 4.2): today's receipts, the coverage summary, the health reports and the last batch,
 * read from the ledger when the popup opens (src/ui/data.ts `loadPopup`) and read again whenever the service worker
 * announces a change to a table they come from. Reads never overlap: a change during a read reads once more after it.
 * A read that fails is said, never shown as an empty day, and logged (Hard Rule 6).
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';

import type { LedgerTable } from '../../src/bus/messages';
import { readFailure } from '../../src/ui/read-failure';
import { log } from '../../src/log';
import { loadPopup, onLedgerChanged, type PopupView } from '../../src/ui/data';

export type PopupState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly view: PopupView; readonly nowMs: number }
  | { readonly status: 'failed' }
  | { readonly status: 'locked' };

/** The tables the popup shows something of. */
export const POPUP_TABLES: readonly LedgerTable[] = [
  'receipts',
  'claims',
  'observations',
  'coverage',
  'adapterHealth',
  'meta',
];

/** Where the popup reads from: the ledger and the bus, or a test's stand-ins. */
export interface PopupSources {
  readonly load: (now: Date) => Promise<PopupView>;
  readonly subscribe: (tables: readonly LedgerTable[], onChange: () => void) => () => void;
  readonly now: () => Date;
}

const LIVE: PopupSources = { load: loadPopup, subscribe: onLedgerChanged, now: () => new Date() };

/** Reads the popup's view, never two reads at once: a read asked for during one runs once more after it. */
interface Reader {
  read(): void;
  close(): void;
}

function reader(sources: PopupSources, show: (state: PopupState) => void): Reader {
  let open = true;
  // Read through a call: a read may outlive the popup's view, and an await hides that from the type checker.
  const isOpen = (): boolean => open;
  let reading = false;
  let requested = 0;
  const run = async (): Promise<void> => {
    requested += 1;
    if (reading) return;
    reading = true;
    try {
      for (let served = 0; isOpen() && served < requested;) {
        served = requested;
        const now = sources.now();
        const view = await sources.load(now);
        if (isOpen()) show({ status: 'ready', view, nowMs: now.getTime() });
      }
    } catch (error) {
      const failure = readFailure(error, (failed) => {
        log.error('popup.read_failed', { error: failed });
      });
      if (isOpen()) show({ status: failure });
    } finally {
      reading = false;
    }
  };
  return {
    read: () => {
      void run();
    },
    close: () => {
      open = false;
    },
  };
}

/**
 * The popup's state (header). The first read starts in a layout effect, as soon as the skeleton is in the page: Preact
 * runs `useEffect` only after a frame, which cost the popup a frame of its 100 ms (sprint_4 4.2). The popup listens for
 * changes only once that read has settled, in an effect that runs after Chrome painted it, so loading the listener and
 * its catch-up read never delay the first paint of the day.
 */
export function usePopupView(sources: PopupSources = LIVE): PopupState {
  const [state, setState] = useState<PopupState>({ status: 'loading' });
  const views = useMemo(() => reader(sources, setState), [sources]);
  useLayoutEffect(() => {
    views.read();
    return () => {
      views.close();
    };
  }, [views]);
  const settled = state.status !== 'loading';
  useEffect(() => {
    if (!settled) return undefined;
    return sources.subscribe(POPUP_TABLES, () => {
      views.read();
    });
  }, [settled, sources, views]);
  return state;
}
