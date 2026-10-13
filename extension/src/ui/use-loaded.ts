/**
 * A module a page needs only in some of its states, loaded the first time it does (Sprint 6 close, tech review TECH-1):
 * the popup's unlock prompt, which a ledger that was never encrypted never shows, so the popup's start does not carry
 * it. A load that fails is logged, and the module stays absent.
 */
import { useEffect, useState } from 'preact/hooks';

import { log } from '../log';

/** What `load` gives, once `when` has been true; undefined until then, and until it has loaded. */
export function useLoaded<T>(when: boolean, load: () => Promise<T>): T | undefined {
  const [loaded, setLoaded] = useState<{ readonly value: T }>();
  useEffect(() => {
    if (!when || loaded !== undefined) return undefined;
    let live = true;
    load().then(
      (value) => {
        if (live) setLoaded({ value });
      },
      (error: unknown) => {
        log.error('ui.load_failed', { error });
      },
    );
    return () => {
      live = false;
    };
  }, [when, loaded, load]);
  return loaded?.value;
}
