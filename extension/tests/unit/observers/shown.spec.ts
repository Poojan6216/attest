/**
 * The one shown-view rule every observer reads with (src/observers/shown.ts; TECH-5; Hard Rule 5): a view the app
 * keeps in the DOM, hidden, is never read. Hidden means the `hidden` attribute or `display: none` on the element or
 * an ancestor, or `visibility: hidden` on the element itself (a descendant can set it back); `aria-hidden` is not
 * hidden from the eye. With a view, computed style decides (a stylesheet rule counts); without one, the inline style.
 */
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import { isShown, shownChecker, shownOnly } from '../../../src/observers/shown';

const BODY = [
  '<style>.gone{display:none}</style>',
  '<div id="plain">a</div>',
  '<div hidden><p id="under-hidden">b</p></div>',
  '<div class="gone"><p id="under-sheet">c</p></div>',
  '<div style="display:none"><p id="under-inline">d</p></div>',
  '<div style="visibility:hidden" id="invisible"><p id="shown-again" style="visibility:visible">e</p></div>',
  '<div aria-hidden="true"><p id="aria">f</p></div>',
].join('');

/** `BODY` parsed in a window (computed style), or in a document with no view (inline style only). */
function page(withView: boolean): { doc: Document; close: () => void } {
  const window = new Window({ url: 'https://mail.google.com/mail/u/0/#sent' });
  const parsed: unknown = withView
    ? new window.DOMParser().parseFromString(`<html><body>${BODY}</body></html>`, 'text/html')
    : window.document.implementation.createHTMLDocument();
  const doc = parsed as Document;
  if (!withView) doc.body.innerHTML = BODY;
  return { doc, close: () => void window.happyDOM.close() };
}

const byId = (doc: Document, id: string): Element => {
  const found = doc.getElementById(id);
  if (found === null) throw new Error(`no #${id}`);
  return found;
};

describe('shown: what the user sees, never a class name (Hard Rule 5)', () => {
  it('with a view: hidden, display none (inline or from a stylesheet) and visibility hidden are not shown', () => {
    const { doc, close } = page(true);
    try {
      expect(doc.defaultView).not.toBeNull();
      const shown = (id: string) => isShown(byId(doc, id));
      expect(['plain', 'aria', 'shown-again'].map(shown)).toEqual([true, true, true]);
      expect(['under-hidden', 'under-sheet', 'under-inline', 'invisible'].map(shown)).toEqual([
        false,
        false,
        false,
        false,
      ]);
    } finally {
      close();
    }
  });

  it('without a view: the hidden attribute and the inline style decide', () => {
    const { doc, close } = page(false);
    try {
      expect(doc.defaultView).toBeNull();
      const shown = (id: string) => isShown(byId(doc, id));
      expect(['plain', 'aria', 'under-sheet'].map(shown)).toEqual([true, true, true]);
      expect(['under-hidden', 'under-inline', 'invisible'].map(shown)).toEqual([false, false, false]);
    } finally {
      close();
    }
  });

  it('one checker per read gives the same answers as a fresh check, and shownOnly keeps document order', () => {
    const { doc, close } = page(true);
    try {
      const all = Array.from(doc.querySelectorAll('[id]'));
      const shown = shownChecker();
      expect(all.map((el) => shown(el))).toEqual(all.map((el) => isShown(el)));
      expect(shownOnly(all, shown).map((el) => el.id)).toEqual(['plain', 'shown-again', 'aria']);
    } finally {
      close();
    }
  });
});
