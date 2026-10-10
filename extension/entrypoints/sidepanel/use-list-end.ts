/**
 * Two behaviours of the timeline's list (sprint_4 4.3): older pages load as its end scrolls into view (an
 * IntersectionObserver on the end, where Chrome has one), and focus returns to a row's Open button when its detail
 * closes (keyboard users land where they were).
 */
import { type RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/** A ref for the list's end: while `more`, `onMore` runs each time it scrolls into view. */
export function useListEnd(more: boolean, onMore: () => void): RefObject<HTMLDivElement> {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = end.current;
    if (!more || target === null || typeof IntersectionObserver === 'undefined') return undefined;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some(({ isIntersecting }) => isIntersecting)) onMore();
    });
    watcher.observe(target);
    return () => {
      watcher.disconnect();
    };
  }, [more, onMore]);
  return end;
}

/** A ref for the list: when `returnTo` is set, the Open button of that receipt's row takes the focus. */
export function useReturnFocus(returnTo: string | null): RefObject<HTMLDivElement> {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (returnTo === null) return;
    root.current
      ?.querySelector<HTMLButtonElement>(`[data-receipt="${returnTo}"] button[aria-label^="Open details"]`)
      ?.focus();
  }, [returnTo]);
  return root;
}
