import { useState } from 'preact/hooks';

import { log } from '../log';
import { Button } from './Button';
import { copyImage as copyImageToClipboard, copyText as copyTextToClipboard } from './clipboard';
import { sharePng, type ShareTheme } from './share-png';
import { useShareImage } from './use-share-image';

export interface SharePreviewProps {
  /** The redacted markdown: shown in full, copied as text, and drawn as the image. */
  readonly markdown: string;
  /** The image's alternative text, such as "This receipt as an image". */
  readonly imageLabel: string;
  readonly copyText?: (text: string) => Promise<void>;
  readonly copyImage?: (image: Blob) => Promise<void>;
  /** Draws the image; the page's own canvas when absent. */
  readonly makeImage?: (markdown: string, theme: ShareTheme) => Promise<Blob>;
}

/**
 * A share before it is copied (sprint_4 4.7, 4.8; agents/ux_engineer.md rule 11, preview before copy): the text in full
 * and the image drawn from it, in the page's own light or dark; Copy text and Copy image, each saying what came of it.
 * An image the page cannot draw is said, and the text can still be copied.
 */
export function SharePreview({
  markdown,
  imageLabel,
  copyText = copyTextToClipboard,
  copyImage = copyImageToClipboard,
  makeImage = sharePng,
}: SharePreviewProps) {
  const image = useShareImage(markdown, makeImage);
  const [said, setSaid] = useState('');
  const copy = (run: () => Promise<void>, done: string): void => {
    run().then(
      () => {
        setSaid(done);
      },
      (error: unknown) => {
        log.warn('share.copy_failed', { error });
        setSaid('Could not copy. Select the text and copy it yourself.');
      },
    );
  };
  return (
    <div class="space-y-2">
      <pre
        aria-label="What you would share"
        tabIndex={0}
        class="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-rule p-row text-xs"
      >
        {markdown}
      </pre>
      {typeof image === 'object' ? (
        <img src={image.url} alt={imageLabel} class="max-w-full rounded border border-rule" />
      ) : null}
      {image === 'failed' ? <p>The image could not be drawn here. The text can still be copied.</p> : null}
      <div class="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            copy(() => copyText(markdown), 'Text copied.');
          }}
        >
          Copy text
        </Button>
        <Button
          variant="secondary"
          disabled={typeof image !== 'object'}
          onClick={() => {
            if (typeof image === 'object') copy(() => copyImage(image.blob), 'Image copied.');
          }}
        >
          Copy image
        </Button>
      </div>
      <p role="status" class="min-h-5">
        {image === 'drawing' ? 'Drawing the image…' : said}
      </p>
    </div>
  );
}
