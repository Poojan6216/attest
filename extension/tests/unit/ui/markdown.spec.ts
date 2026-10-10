/**
 * The shares' markdown (src/ui/markdown.ts; sprint_4 close, tech review TECH-8): removing every escape gives back the
 * text that was escaped, whatever it holds, so the share's image and the tests read exactly what a share was given.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { escapeMarkdown, unescapeMarkdown } from '../../../src/ui/markdown';

describe('escapeMarkdown and unescapeMarkdown', () => {
  it('are each other’s inverse, on any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(unescapeMarkdown(escapeMarkdown(text))).toBe(text);
      }),
    );
  });

  it('leave no character markdown reads unescaped', () => {
    expect(escapeMarkdown('# a_b *c* [d](e) `f` \\g')).toBe('\\# a\\_b \\*c\\* \\[d\\]\\(e\\) \\`f\\` \\\\g');
  });
});
