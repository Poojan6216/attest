/**
 * A receipt shared on the built extension (sprint_4 4.8 done-when: "the PNG renders legibly in dark and light"). After
 * the build_spec §2 demo, the side panel's UNASKED receipt is shared: its text holds "Likely agent", the vendor's
 * domain and no address; its image is drawn in the panel's own light or dark, and read back pixel by pixel its
 * background is light or dark as the panel is, and its text stands out from it far beyond the 4.5:1 contrast text
 * needs. No console error.
 */
import { expect, type Page, test } from '@playwright/test';

import { DEMO_LOG } from './support/demo';
import { openDemoPages, writeAway } from './support/demo-flow';
import { pasteActivity } from './support/paste';
import { withVendorSession } from './support/session';

interface Legibility {
  readonly width: number;
  /** The relative luminance of the card's background, 0 (black) to 1 (white). */
  readonly background: number;
  /** The share of pixels whose contrast with the background is at least 4.5:1: the text. */
  readonly inked: number;
  /** The highest contrast of any pixel with the background. */
  readonly contrast: number;
}

/** Reads the shared image back, pixel by pixel, in the panel (no named function: the page runs it alone). */
async function legibility(panel: Page): Promise<Legibility> {
  return panel.evaluate(async () => {
    const image = document.querySelector<HTMLImageElement>('img[alt="This receipt as an image"]');
    if (image === null) throw new Error('no image');
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no canvas');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const lum: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b] = [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0].map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      lum.push(0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0));
    }
    // A point inside the card's padding, clear of its border and of any text.
    const background = lum[20 * canvas.width + 20] ?? 0;
    let inked = 0;
    let contrast = 1;
    for (const value of lum) {
      const ratio = (Math.max(value, background) + 0.05) / (Math.min(value, background) + 0.05);
      if (ratio >= 4.5) inked += 1;
      contrast = Math.max(contrast, ratio);
    }
    return { width: canvas.width, background, inked: inked / lum.length, contrast };
  });
}

async function shareUnasked(panel: Page): Promise<string> {
  await panel
    .locator('li[data-receipt]')
    .filter({ hasText: 'Likely agent' })
    .getByRole('button')
    .first()
    .click();
  await panel.getByRole('button', { name: 'Share this receipt' }).click();
  await expect(panel.getByRole('img', { name: 'This receipt as an image' })).toBeVisible();
  return (await panel.getByLabel('What you would share').textContent()) ?? '';
}

test('a shared receipt is redacted, and its image is legible in light and in dark', async () => {
  test.setTimeout(4 * 60_000);
  await withVendorSession(async (session) => {
    await openDemoPages(session);
    await writeAway(session);
    const paste = await session.extension.openExtensionPage('sidepanel.html');
    expect(await pasteActivity(paste, 'Muse', DEMO_LOG)).toBe('Imported 2 claims.');
    for (const colorScheme of ['light', 'dark'] as const) {
      const panel = await session.extension.openExtensionPage('sidepanel.html');
      const errors: string[] = [];
      panel.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await panel.emulateMedia({ colorScheme });
      const text = await shareUnasked(panel);
      expect(text).toContain('Likely agent: Muse');
      expect(text).toContain('supplier\\.example');
      expect(text).not.toMatch(/@/u);
      const seen = await legibility(panel);
      expect(seen.width).toBeGreaterThanOrEqual(1000);
      if (colorScheme === 'light') expect(seen.background).toBeGreaterThan(0.8);
      else expect(seen.background).toBeLessThan(0.05);
      expect(seen.inked).toBeGreaterThan(0.005);
      expect(seen.contrast).toBeGreaterThan(12);
      expect(errors).toEqual([]);
      await panel.close();
    }
  });
});
