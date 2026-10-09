/**
 * Records every input event a page sees (qa_tester rule 5: Attest never acts on a vendor page, Hard Rule 3), for any
 * end-to-end test that opens vendor pages: installed on a browser context before its pages open, read from each page
 * after the test's work. Shared by no-input-events.spec.ts and the §2 demo (demo-paste.spec.ts; Sprint 3 QA review
 * GAP 9).
 */
import type { BrowserContext, Page } from '@playwright/test';

/** Every event a script could use to act on a page: pointer, mouse, keyboard, text, form, clipboard, drag. */
export const INPUT_EVENTS = [
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'change',
  'select',
  'submit',
  'reset',
  'paste',
  'cut',
  'copy',
  'dragstart',
  'drop',
] as const;

export interface Recorded {
  readonly type: string;
  readonly trusted: boolean;
}

export async function installRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript((types: readonly string[]) => {
    const seen: { type: string; trusted: boolean }[] = [];
    Object.defineProperty(window, '__attestInputEvents', { value: seen });
    for (const type of types) {
      window.addEventListener(
        type,
        (event) => {
          seen.push({ type: event.type, trusted: event.isTrusted });
        },
        { capture: true },
      );
    }
  }, INPUT_EVENTS);
}

export async function recorded(page: Page): Promise<Recorded[]> {
  const seen: unknown = await page.evaluate(() => {
    const value: unknown = Reflect.get(window, '__attestInputEvents');
    if (!Array.isArray(value)) throw new Error('input recorder not installed');
    return Array.from(value as readonly unknown[]);
  });
  if (!Array.isArray(seen)) throw new Error('input recorder returned no list');
  return seen.map((entry: unknown) => {
    const type: unknown =
      typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'type') : undefined;
    const trusted: unknown =
      typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'trusted') : undefined;
    if (typeof type !== 'string' || typeof trusted !== 'boolean') throw new Error('malformed input record');
    return { type, trusted };
  });
}
