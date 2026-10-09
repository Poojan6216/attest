/**
 * What a share puts on the clipboard (sprint_4 4.7, 4.8), at the person's own click: the text, or the image. Nothing is
 * sent anywhere; the person pastes it where they choose.
 */

/** Puts `text` on the clipboard. */
export const copyText = (text: string): Promise<void> => navigator.clipboard.writeText(text);

/** Puts `image` (a PNG) on the clipboard. */
export const copyImage = (image: Blob): Promise<void> =>
  navigator.clipboard.write([new ClipboardItem({ [image.type]: image })]);
