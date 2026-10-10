// @vitest-environment happy-dom
/**
 * A share drawn as an image (sprint_4 4.8; src/ui/share-png.ts `sharePng`), over a stand-in canvas that measures every
 * character 8 pixels wide and records what is drawn (Sprint 4 QA review: the drawing ran only in the end-to-end test,
 * tests/e2e/share.spec.ts, which reads the pixels back; unit coverage of share-png.ts was 25% of lines). It holds:
 *  - every line of the share is drawn, in order, a title, headings, items and text each in its own font, each wrapped
 *    to the card's 576 pixels between its 32-pixel paddings by words, the words of a line all drawn and in order;
 *  - a word wider than the card stands alone on its row, never cut;
 *  - the card is 640 pixels wide drawn at twice that, as tall as its rows and paddings, on the theme's background, with
 *    text in the theme's muted ink and everything else in its ink;
 *  - a page with no canvas, or a canvas that gives no image, is refused, so the side panel says so.
 * Every value is invented.
 */
import { describe, expect, it } from 'vitest';

import { SHARE_PALETTES, type ShareTheme, shareLines, sharePng } from '../../../src/ui/share-png';

const CHAR_PX = 8;
const CARD = 640;
const PAD = 32;
const ROW_HEIGHTS = { title: 34, heading: 28, item: 22, text: 20, blank: 8 } as const;

interface Drawn {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly fill: string;
}

/**
 * A document whose canvas records what is drawn on it: a real happy-dom canvas, its 2D context and its image replaced
 * (happy-dom draws nothing). `context` false gives no 2D context, `image` false no image.
 */
function standIn({ context: hasContext = true, image = true } = {}) {
  const drawn: Drawn[] = [];
  const backgrounds: string[] = [];
  const context = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    textBaseline: '',
    scale: () => undefined,
    fillRect: () => {
      backgrounds.push(context.fillStyle);
    },
    strokeRect: () => undefined,
    measureText: (text: string) => ({ width: text.length * CHAR_PX }),
    fillText: (text: string, x: number, y: number) => {
      drawn.push({ text, x, y, font: context.font, fill: context.fillStyle });
    },
  };
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', { value: () => (hasContext ? context : null) });
  Object.defineProperty(canvas, 'toBlob', {
    value: (done: (blob: Blob | null) => void, type: string) => {
      done(image ? new Blob(['png'], { type }) : null);
    },
  });
  const doc = document.implementation.createHTMLDocument('share');
  Object.defineProperty(doc, 'createElement', { value: () => canvas });
  return { doc, drawn, backgrounds, canvas };
}

const LONG_ITEM = Array.from({ length: 30 }, (_, index) => `word${String(index)}`).join(' ');
const MARKDOWN = [
  '# Attest receipt: Not found',
  '',
  '- Agent: Muse',
  `- ${LONG_ITEM}`,
  '',
  '## Why',
  '',
  `- ${'x'.repeat(100)} and after`,
  'Made by Attest from this browser’s own ledger\\.',
  '',
].join('\n');

describe('sharePng', () => {
  it.each<ShareTheme>(['light', 'dark'])(
    'draws every line in its font, wrapped to the card by words, in the %s palette',
    async (theme) => {
      const { doc, drawn, backgrounds, canvas } = standIn();
      const blob = await sharePng(MARKDOWN, theme, doc);
      expect(blob.type).toBe('image/png');
      const palette = SHARE_PALETTES[theme];
      expect(backgrounds).toEqual([palette.background]);

      // Every word of every line is drawn, in order, and no row is wider than the card unless it is one word.
      const lines = shareLines(MARKDOWN).filter(({ kind }) => kind !== 'blank');
      expect(drawn.map(({ text }) => text).join(' ')).toBe(lines.map(({ text }) => text).join(' '));
      for (const row of drawn) {
        expect(row.x).toBe(PAD);
        const wide = row.text.length * CHAR_PX > CARD - 2 * PAD;
        if (wide) expect(row.text.split(' ')).toHaveLength(1);
      }
      expect(drawn.some(({ text }) => text === 'x'.repeat(100))).toBe(true);
      expect(drawn.filter(({ text }) => text.startsWith('• word') || text.startsWith('word')).length).toBe(3);
      const ys = drawn.map(({ y }) => y);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));

      // Fonts and inks by kind: the title, the heading, the items, and the closing text in the muted ink.
      expect(drawn[0]).toMatchObject({ text: 'Attest receipt: Not found', fill: palette.ink });
      expect(drawn[0]?.font).toContain('22px');
      expect(drawn.find(({ text }) => text === 'Why')?.font).toContain('16px');
      expect(drawn.find(({ text }) => text === '• Agent: Muse')?.font).toContain('15px');
      const closing = drawn.filter(({ fill }) => fill === palette.muted);
      expect(closing.map(({ text }) => text).join(' ')).toBe(
        'Made by Attest from this browser’s own ledger.',
      );
      expect(closing.every(({ font }) => font.includes('13px'))).toBe(true);

      // The card: 640 wide at twice the scale, as tall as its rows and paddings.
      const rows = drawn.length;
      const blanks = shareLines(MARKDOWN).filter(({ kind }) => kind === 'blank').length;
      const height =
        2 * PAD +
        blanks * ROW_HEIGHTS.blank +
        drawn.reduce((sum, { font }) => {
          if (font.includes('22px')) return sum + ROW_HEIGHTS.title;
          if (font.includes('16px')) return sum + ROW_HEIGHTS.heading;
          if (font.includes('15px')) return sum + ROW_HEIGHTS.item;
          return sum + ROW_HEIGHTS.text;
        }, 0);
      expect(rows).toBeGreaterThan(lines.length);
      expect([canvas.width, canvas.height]).toEqual([2 * CARD, 2 * height]);
    },
  );
});

describe('sharePng, where it cannot draw', () => {
  it('refuses a page with no canvas, and a canvas that gives no image, each with a typed error', async () => {
    await expect(sharePng(MARKDOWN, 'light', standIn({ context: false }).doc)).rejects.toMatchObject({
      name: 'ShareImageError',
      code: 'no_canvas',
    });
    await expect(sharePng(MARKDOWN, 'dark', standIn({ image: false }).doc)).rejects.toMatchObject({
      name: 'ShareImageError',
      code: 'no_image',
    });
  });
});
