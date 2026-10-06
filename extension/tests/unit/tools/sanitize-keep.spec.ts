/**
 * --keep-selector (tests/tools/sanitize.ts): a redacted text is also replaced wherever else it appears, which on a
 * real Gmail page turned every row's date into a fake phrase (the hidden screen-reader summary repeats each row's
 * date) and an open receipt's subject into the hidden list's fake one (capture of 2026-10-06). Inside a kept area a
 * redacted text is never replaced; names, emails and amounts still are.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { loadSeeds, SEEDS_PATH } from '../../tools/capture-output';
import { sanitizeHtml, type SanitizeOptions, type SeedSecret } from '../../tools/sanitize';

let SEEDS: SeedSecret[] = [];

beforeAll(async () => {
  SEEDS = await loadSeeds(SEEDS_PATH);
});

const PAGE = [
  '<!doctype html><html><head><title>t</title></head><body><div role="main"><table><tbody>',
  '<tr><td class="who"><div class="summary" style="display: none">Private snippet text, <span>Oct 5</span></div></td>',
  '<td class="date"><span title="Mon, Oct 5, 2026, 9:41 PM">Oct 5</span></td>',
  '<td class="note">Write to priya.raman@northwind-traders.com on Oct 5</td></tr>',
  '</tbody></table></div></body></html>',
].join('');

function run(options: Partial<SanitizeOptions>): string {
  return sanitizeHtml(PAGE, { seed: 'unit', seeds: SEEDS, redactSelectors: ['.summary'], ...options }).html;
}

const cell = (html: string, kind: string): string =>
  new RegExp(`<td class="${kind}">(.*?)</td>`).exec(html)?.[1] ?? '';

describe('--keep-selector', () => {
  it('without it, a redacted date is replaced everywhere it appears (the defect it fixes)', () => {
    const html = run({});
    expect(cell(html, 'who')).not.toContain('Oct 5');
    expect(cell(html, 'date')).not.toContain('Oct 5');
  });

  it('inside a kept area the redacted date stays, in its text and in its title; outside it is still replaced', () => {
    const html = run({ keepSelectors: ['td.date'] });
    expect(cell(html, 'who')).not.toContain('Private snippet text');
    expect(cell(html, 'who')).not.toContain('Oct 5');
    expect(cell(html, 'date')).toBe('<span title="Mon, Oct 5, 2026, 9:41 PM">Oct 5</span>');
    expect(cell(html, 'note')).not.toContain('Oct 5');
  });

  it('a kept area still loses its emails and the names learned from them', () => {
    const html = run({ keepSelectors: ['td.note'] });
    expect(cell(html, 'note')).toContain('Oct 5');
    expect(cell(html, 'note')).not.toContain('northwind-traders');
    expect(cell(html, 'note')).not.toContain('priya.raman');
  });
});
