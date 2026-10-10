/**
 * The accessibility and copy checks a surface is held to on the built extension (sprint_4 4.10; agents/ux_engineer.md
 * rules 1, 4 and 10 and its copy rules):
 *  - axe-core: no serious or critical violation;
 *  - the copy it renders, text and every `aria-label`, `title`, `alt` and `placeholder`: no exclamation mark, no grade
 *    or flag as its code (`NOT_FOUND`), every grade chip one of the six grade names, and every UNASKED row saying
 *    "Likely agent";
 *  - the keyboard: Tab reaches every visible control, each with a visible focus outline (./options-page.ts);
 *  - motion: with reduced motion asked for, nothing on the page animates.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expectVisibleFocus, focusState } from './options-page';

/** The six grade names a chip may say (src/ui/receipt-labels.ts `gradeLabel`). */
export const GRADE_NAMES = [
  'Verified',
  'Partial',
  'Not found',
  'Unasked',
  'Over scope',
  'Unverifiable',
] as const;

/** What a keyboard can reach: the options page's walk (tests/e2e/options.spec.ts), on every surface. */
export const INTERACTIVE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="radio"])',
  'input[type="radio"]:checked',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** The serious and critical axe-core violations on the page, each with the elements it names. */
export async function seriousViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(' ')).join(', ')}`);
}

export interface CopyReport {
  /** What breaks the copy rules, in words. */
  readonly faults: readonly string[];
  /**
   * How many verbatim blocks (`[data-verbatim]`) the page showed: data shown exactly as it is sent (the telemetry
   * payload the options page previews, sprint_5 5.7), whose keys are the schema's (`NOT_FOUND`), not prose. Their text
   * is left out of the copy rules, and each surface says how many it may show.
   */
  readonly verbatim: number;
  /** How many grade chips, and how many UNASKED rows, the page showed: a check over none proves nothing. */
  readonly chips: number;
  readonly unaskedRows: number;
}

/** The copy the page renders, held to the rules (header). The page runs this alone, so it names no function. */
export async function copyReport(page: Page): Promise<CopyReport> {
  return page.evaluate((names: readonly string[]) => {
    const faults: string[] = [];
    const attributes = ['aria-label', 'title', 'alt', 'placeholder'];
    const verbatim = [...document.querySelectorAll<HTMLElement>('[data-verbatim]')];
    let prose = document.body.innerText;
    for (const block of verbatim) prose = prose.replace(block.innerText, '');
    const pieces = [
      prose,
      ...[...document.querySelectorAll('[aria-label], [title], [alt], [placeholder]')].flatMap((element) =>
        attributes.map((name) => element.getAttribute(name) ?? '').filter((value) => value !== ''),
      ),
    ];
    for (const piece of pieces) {
      const mark = piece.indexOf('!');
      if (mark >= 0) faults.push(`an exclamation mark: "${piece.slice(Math.max(0, mark - 40), mark + 1)}"`);
      const code = /\b[A-Z]{2,}_[A-Z_]{2,}\b/u.exec(piece);
      if (code !== null) faults.push(`a code: ${code[0]}`);
    }
    let chips = 0;
    for (const chip of document.querySelectorAll('span')) {
      const label = chip.querySelector(':scope > .sr-only');
      if (label?.textContent !== 'Grade: ') continue;
      chips += 1;
      const grade = chip.textContent.slice('Grade: '.length);
      if (!names.includes(grade)) faults.push(`a grade chip that says "${grade}"`);
    }
    let unaskedRows = 0;
    for (const row of document.querySelectorAll('li[data-receipt]')) {
      if (!row.textContent.includes('Grade: Unasked')) continue;
      unaskedRows += 1;
      if (!row.textContent.includes('Likely agent:')) faults.push('an UNASKED row without "Likely agent"');
    }
    return { faults, verbatim: verbatim.length, chips, unaskedRows };
  }, GRADE_NAMES);
}

export interface TabWalk {
  /** How many visible controls the page has. */
  readonly controls: number;
  /** The controls Tab never reached, by label. */
  readonly missed: readonly string[];
}

/**
 * Marks every visible control, then presses Tab through the page twice over (focus may start part way down, at a
 * heading a view focuses when it opens): each control reached shows a visible focus outline, and the walk resolves
 * the ones never reached.
 */
export async function tabWalk(page: Page): Promise<TabWalk> {
  const labels = await page.evaluate((selector) => {
    const elements = [...document.querySelectorAll<HTMLElement>(selector)].filter((element) =>
      element.checkVisibility(),
    );
    elements.forEach((element, index) => {
      element.dataset.e2eTab = String(index);
    });
    return elements.map((element) =>
      (element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 60),
    );
  }, INTERACTIVE);
  const reached = new Set<string>();
  for (let press = 0; press < 2 * (labels.length + 2); press += 1) {
    await page.keyboard.press('Tab');
    const state = await focusState(page);
    if (state.marker === null) continue;
    reached.add(state.marker);
    await expectVisibleFocus(page, state);
  }
  return { controls: labels.length, missed: labels.filter((_, index) => !reached.has(String(index))) };
}

/** The animations running on the page (none when reduced motion is asked for and respected). */
export async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter(({ playState }) => playState === 'running')
      .map((animation) => (animation instanceof CSSAnimation ? animation.animationName : animation.id)),
  );
}
