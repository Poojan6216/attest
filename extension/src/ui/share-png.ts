/**
 * A share as an image (sprint_4 4.8; agents/ux_engineer.md rule 11): the same redacted markdown a share copies as text
 * (./receipt-share.ts, ./digest-share.ts), drawn on a canvas in the page that shows it, line by line and wrapped to the
 * card's width: a `#` line as its title, a `##` line as a heading, a `- ` line as an item, every escape removed. Light
 * or dark, as the page is; either palette's ink is far above the 4.5:1 contrast text needs. It is drawn in the page
 * itself, a side panel or the digest page, which has a DOM and a canvas, so no `offscreen` document is needed
 * (Decisions [4.8]; Hard Rule 8). Pixels only: nothing is sent anywhere.
 */
import { unescapeMarkdown } from './markdown';

export type ShareTheme = 'light' | 'dark';

/** Why a share's image could not be drawn: the page gave no 2D canvas, or its canvas gave no image. */
export type ShareImageErrorCode = 'no_canvas' | 'no_image';

/**
 * A share's image not drawn (sprint_4 close, tech review TECH-11). Its message is its code alone, so it never prints
 * content (Hard Rule 10).
 */
export class ShareImageError extends Error {
  override readonly name = 'ShareImageError';
  readonly code: ShareImageErrorCode;

  constructor(code: ShareImageErrorCode) {
    super(`share image: ${code}`);
    this.code = code;
  }
}

interface Palette {
  readonly background: string;
  readonly ink: string;
  readonly muted: string;
  readonly rule: string;
}

export const SHARE_PALETTES: Readonly<Record<ShareTheme, Palette>> = Object.freeze({
  light: { background: '#ffffff', ink: '#111827', muted: '#374151', rule: '#d1d5db' },
  dark: { background: '#111827', ink: '#f9fafb', muted: '#d1d5db', rule: '#4b5563' },
});

export type LineKind = 'title' | 'heading' | 'item' | 'text' | 'blank';

export interface ShareLine {
  readonly kind: LineKind;
  readonly text: string;
}

/** The markdown's lines as the image draws them (header). Pure. */
export function shareLines(markdown: string): ShareLine[] {
  return markdown
    .replace(/\n+$/u, '')
    .split('\n')
    .map((line): ShareLine => {
      if (line === '') return { kind: 'blank', text: '' };
      if (line.startsWith('## ')) return { kind: 'heading', text: unescapeMarkdown(line.slice(3)) };
      if (line.startsWith('# ')) return { kind: 'title', text: unescapeMarkdown(line.slice(2)) };
      if (line.startsWith('- ')) return { kind: 'item', text: `• ${unescapeMarkdown(line.slice(2))}` };
      return { kind: 'text', text: unescapeMarkdown(line) };
    });
}

/** The card's width in CSS pixels, its padding, and the scale it is drawn at (sharp on a high-density screen). */
const WIDTH = 640;
const PAD = 32;
const SCALE = 2;
/** The middle of the card's first pixel: a one-pixel border drawn there is crisp. */
const EDGE = 1 / 2;

const STYLES: Readonly<Record<LineKind, { readonly font: string; readonly height: number }>> = {
  title: { font: '600 22px system-ui, -apple-system, "Segoe UI", sans-serif', height: 34 },
  heading: { font: '600 16px system-ui, -apple-system, "Segoe UI", sans-serif', height: 28 },
  item: { font: '15px system-ui, -apple-system, "Segoe UI", sans-serif', height: 22 },
  text: { font: '13px system-ui, -apple-system, "Segoe UI", sans-serif', height: 20 },
  blank: { font: '13px system-ui, sans-serif', height: 8 },
};

/** `text` wrapped to `width` on `context`'s current font, by words (a word longer than the width stands alone). */
function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(' ')) {
    const next = row === '' ? word : `${row} ${word}`;
    if (row !== '' && context.measureText(next).width > width) {
      rows.push(row);
      row = word;
    } else row = next;
  }
  rows.push(row);
  return rows;
}

/** Each line wrapped, with the style it is drawn in. */
function layout(context: CanvasRenderingContext2D, lines: readonly ShareLine[]): ShareLine[] {
  return lines.flatMap(({ kind, text }): ShareLine[] => {
    context.font = STYLES[kind].font;
    return kind === 'blank'
      ? [{ kind, text }]
      : wrap(context, text, WIDTH - 2 * PAD).map((row): ShareLine => ({ kind, text: row }));
  });
}

/** The markdown drawn as a PNG in `theme` (header); rejects (`ShareImageError`) when the page can draw none. */
export async function sharePng(markdown: string, theme: ShareTheme, doc: Document = document): Promise<Blob> {
  const canvas = doc.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (measure === null) throw new ShareImageError('no_canvas');
  const rows = layout(measure, shareLines(markdown));
  const height = 2 * PAD + rows.reduce((sum, { kind }) => sum + STYLES[kind].height, 0);
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const context = canvas.getContext('2d');
  if (context === null) throw new ShareImageError('no_canvas');
  const palette = SHARE_PALETTES[theme];
  context.scale(SCALE, SCALE);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, WIDTH, height);
  context.strokeStyle = palette.rule;
  context.strokeRect(EDGE, EDGE, WIDTH - 1, height - 1);
  context.textBaseline = 'top';
  let y = PAD;
  for (const { kind, text } of rows) {
    context.font = STYLES[kind].font;
    context.fillStyle = kind === 'text' ? palette.muted : palette.ink;
    if (kind !== 'blank') context.fillText(text, PAD, y + 3);
    y += STYLES[kind].height;
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new ShareImageError('no_image'));
      else resolve(blob);
    }, 'image/png');
  });
}
