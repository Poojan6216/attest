/**
 * Captioned frames for the launch's pictures (sprint_7 7.3 and 7.4): the demo GIF's frames (../demo.record.ts) and the
 * store's screenshots (../store-shots.record.ts) alike are 1280×800, a page's screenshot, or a few words, centred above
 * a one-line caption. Drawn by a blank page of the test's own browser, never by a page Attest reads.
 */
import type { BrowserContext, Page } from '@playwright/test';

export const FRAME = { width: 1280, height: 800 } as const;
export const CAPTION_HEIGHT = 96;
/** A page's screenshot above the caption. */
export const SHOT = { width: FRAME.width, height: FRAME.height - CAPTION_HEIGHT } as const;
/** The popup and the side panel, at the width Chrome draws them. */
export const PANEL = { width: 400, height: SHOT.height } as const;

/** A screenshot above its caption, or a frame of words alone above it (Sprint 7 close, tech review TECH-7). */
export type Frame =
  { readonly caption: string; readonly image: Buffer } | { readonly caption: string; readonly words: string };

const escape = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char,
  );

/** A screenshot of `page` at `size`, in front. */
export async function shoot(
  page: Page,
  size: { readonly width: number; readonly height: number },
): Promise<Buffer> {
  await page.setViewportSize(size);
  await page.bringToFront();
  return page.screenshot({ type: 'png' });
}

/** `html` drawn by a blank page of `context` at `size`, as a PNG. */
export async function draw(
  context: BrowserContext,
  size: { readonly width: number; readonly height: number },
  html: string,
): Promise<Buffer> {
  const page = await context.newPage();
  await page.setViewportSize(size);
  await page.setContent(html);
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  return png;
}

/** `frame` drawn at 1280×800: its screenshot or words above, its caption in a bar below. */
export function compose(context: BrowserContext, frame: Frame): Promise<Buffer> {
  const top =
    'words' in frame
      ? `<p class="words">${escape(frame.words)}</p>`
      : `<img src="data:image/png;base64,${frame.image.toString('base64')}" alt="">`;
  return draw(
    context,
    FRAME,
    `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${String(FRAME.width)}px; height: ${String(FRAME.height)}px; overflow: hidden; }
    body { display: flex; flex-direction: column; background: #e8eaed; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .shot { height: ${String(SHOT.height)}px; display: flex; align-items: center; justify-content: center; }
    img { max-width: 100%; max-height: 100%; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25); }
    .words { margin: 0 96px; font-size: 44px; line-height: 1.35; color: #202124; text-align: center; }
    .caption { height: ${String(CAPTION_HEIGHT)}px; box-sizing: border-box; padding: 0 40px; display: flex; align-items: center;
      background: #202124; color: #fff; font-size: 26px; line-height: 1.3; }
  </style></head><body><div class="shot">${top}</div><div class="caption">${escape(frame.caption)}</div></body></html>`,
  );
}
