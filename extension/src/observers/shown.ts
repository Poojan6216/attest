/**
 * Whether an element is drawn on screen (sprint_2 2.2, 2.3, 2.5; Hard Rule 5): the one shown-view rule every
 * observer reads with. A single-page app keeps the views the user left (Gmail's Inbox, Drafts or an earlier
 * conversation, Calendar's earlier week) in the DOM, hidden, beside the one it shows. An observer reads only the
 * region actually shown, so a hidden Inbox list is never read as the Sent list, a hidden conversation is never the
 * one open, and a hidden earlier week is never reported as the week the user sees.
 *
 * Read-only (Hard Rule 3): the `hidden` attribute and computed style only, nothing written, nothing focused or
 * scrolled, never a class name. `aria-hidden` does not count: it hides an element from assistive technology, not
 * from the eye (a modal dialog sets it on the page behind it, which the user still sees).
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

/** A shown-check: see `shownChecker`. */
export type ShownCheck = (element: Element) => boolean;

/**
 * A shown-check for one read of the page: true when neither the element nor any ancestor has the `hidden`
 * attribute or computes to `display: none`, and the element itself is not `visibility: hidden`. Without a view (a
 * detached document), the inline `style` decides. Ancestors' answers are kept, so checking every chip of a month or
 * every control of a list costs one walk per element. Make one per read: a kept answer describes the page as it was.
 */
export function shownChecker(): ShownCheck {
  const displayed = new Map<Element, boolean>();
  const chainDisplayed = (element: Element | null): boolean => {
    if (element === null) return true;
    const known = displayed.get(element);
    if (known !== undefined) return known;
    const view = element.ownerDocument.defaultView;
    const value =
      !element.hasAttribute('hidden') &&
      !hiddenByStyle(element, view, false) &&
      chainDisplayed(element.parentElement);
    displayed.set(element, value);
    return value;
  };
  return (element) =>
    chainDisplayed(element) && !hiddenByStyle(element, element.ownerDocument.defaultView, true);
}

/** Whether `element` is shown (see `shownChecker`), with a check of its own. */
export function isShown(element: Element): boolean {
  return shownChecker()(element);
}

/** The elements of `list` that are shown, in document order (`shown`: the read's own check, if it has one). */
export function shownOnly(list: ArrayLike<Element>, shown: ShownCheck = isShown): Element[] {
  return Array.from(list).filter((element) => shown(element));
}
