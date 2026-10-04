/**
 * Whether an element is drawn on screen (sprint_2 2.5; Hard Rule 5). A single-page app keeps views the user left
 * (an earlier week, another view) in the DOM, hidden, beside the one it shows. The Calendar observer reads only the
 * region actually shown, so a hidden earlier week is never reported as the week the user sees.
 *
 * The same rule as src/observers/gmail/shown.ts (kept apart while that file is being written; both belong in one
 * src/observers/shown.ts). Read-only (Hard Rule 3): attributes and computed style only. `aria-hidden` does not
 * count: it hides an element from assistive technology, not from the eye.
 */

/** Inline declarations that hide an element (read when the document has no view to compute style with). */
const INLINE_DISPLAY_NONE = /(?:^|;)\s*display\s*:\s*none\s*(?:!important\s*)?(?:;|$)/iu;
const INLINE_INVISIBLE = /(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)\s*(?:!important\s*)?(?:;|$)/iu;

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
 * A shown-check for one read: true when neither the element nor any ancestor has the `hidden` attribute or computes
 * to `display: none`, and the element itself is not `visibility: hidden`. Without a view (a parsed document), the
 * inline `style` decides. Ancestors' answers are kept, so checking every chip of a month costs one walk per element.
 */
export function shownChecker(): (element: Element) => boolean {
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

/** Whether `element` is shown (see `shownChecker`). */
export function isShown(element: Element): boolean {
  return shownChecker()(element);
}

/** The elements of `list` that are shown, in document order. */
export function shownOnly(
  list: ArrayLike<Element>,
  shown: (element: Element) => boolean = isShown,
): Element[] {
  return Array.from(list).filter((element) => shown(element));
}
