/**
 * Whether an element is drawn on screen (sprint_2 2.2; Hard Rule 5). Gmail keeps the views the user opened earlier
 * (Inbox, Drafts, a label) in the DOM, hidden, beside the one it shows. The Sent observer reads only the region
 * actually shown, so a hidden Inbox list is never read as the Sent list.
 *
 * Read-only (Hard Rule 3): attributes and computed style only, nothing written, nothing focused or scrolled.
 * `aria-hidden` does not count: it hides an element from assistive technology, not from the eye (a modal dialog
 * sets it on the page behind it, which the user still sees).
 */

/** Inline declarations that hide an element (read when the document has no view to compute style with). */
const INLINE_DISPLAY_NONE = /(?:^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(?:;|$)/iu;
const INLINE_INVISIBLE = /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)\s*(?:!important\s*)?(?:;|$)/iu;

/** `display: none` on `element`, or (`self` only) `visibility: hidden`, which a descendant can set back. */
function hiddenByStyle(element: Element, view: Window | null, self: boolean): boolean {
  if (view === null) {
    const inline = element.getAttribute('style') ?? '';
    return INLINE_DISPLAY_NONE.test(inline) || (self && INLINE_INVISIBLE.test(inline));
  }
  const style = view.getComputedStyle(element);
  if (style.display === 'none') return true;
  return self && (style.visibility === 'hidden' || style.visibility === 'collapse');
}

/**
 * True when neither `element` nor any ancestor has the `hidden` attribute or computes to `display: none`, and the
 * element itself is not `visibility: hidden`. Without a view (a detached document), the inline `style` decides.
 */
export function isShown(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if (at.hasAttribute('hidden')) return false;
    if (hiddenByStyle(at, view, at === element)) return false;
  }
  return true;
}

/** The elements of `list` that are shown, in document order. */
export function shownOnly(list: ArrayLike<Element>): Element[] {
  return Array.from(list).filter(isShown);
}
