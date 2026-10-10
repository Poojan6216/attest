/**
 * A page's read of the ledger, read again on each change the service worker announces, in order (sprint_4 close, tech
 * review TECH-2: the popup's ordering, entrypoints/popup/use-popup-view.ts, for the options and digest pages too). Never
 * two reads at once: a change during a read reads once more after it. A read for a `load` since replaced (the page asked
 * for something else) lands nowhere, so the newest state always wins. A read that fails is said (`failed`) and passed
 * to `onError`, which logs it (Hard Rule 6); one that meets an encrypted ledger locked is said as `locked` (sprint_6
 * 6.5), and read again once it is unlocked (src/ui/data.ts `onLedgerChanged`). `load`, `subscribe` and `onError` are kept stable by the caller: a new
 * `load` starts a new read.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { isLedgerLocked } from '../ledger/errors';
import { serial } from './serial';

export type LedgerRead<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'locked' }
  | { readonly status: 'ready'; readonly value: T };

export function useLedgerRead<T>(
  load: () => Promise<T>,
  subscribe: (onChange: () => void) => () => void,
  onError: (error: unknown) => void,
): LedgerRead<T> {
  const [state, setState] = useState<LedgerRead<T>>({ status: 'loading' });
  const current = useRef(load);
  current.current = load;
  const read = useMemo(
    () =>
      serial(async () => {
        try {
          const value = await load();
          if (current.current === load) setState({ status: 'ready', value });
        } catch (error) {
          // A locked ledger (sprint_6 6.5) is no failure: the page says so and offers the unlock.
          const locked = isLedgerLocked(error);
          if (!locked) onError(error);
          if (current.current === load) setState({ status: locked ? 'locked' : 'failed' });
        }
      }),
    [load, onError],
  );
  useEffect(() => {
    read();
    return subscribe(read);
  }, [read, subscribe]);
  return state;
}
