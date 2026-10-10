/**
 * Mounts a surface's root component into its page's `#app` element. A missing root fails loudly (Hard Rule 6):
 * a blank popup with nothing in the log would hide the failure.
 */
import { type ComponentType, h, render } from 'preact';

import { log } from '../log';

export type Surface = 'popup' | 'sidepanel' | 'options' | 'digest' | 'dev' | 'model-check';

export const ROOT_ELEMENT_ID = 'app';

/** Renders `App` into `#app`; returns false (and logs `ui.root_missing`) when the page has no such element. */
export function mount(App: ComponentType, surface: Surface, doc: Document = document): boolean {
  const root = doc.getElementById(ROOT_ELEMENT_ID);
  if (root === null) {
    log.error('ui.root_missing', { surface });
    return false;
  }
  render(h(App, null), root);
  return true;
}
