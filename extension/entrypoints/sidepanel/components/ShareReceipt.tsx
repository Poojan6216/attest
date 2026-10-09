import { useState } from 'preact/hooks';

import { Button } from '../../../src/ui/Button';
import { receiptMarkdown, type ShareInput } from '../../../src/ui/receipt-share';
import type { ShareTheme } from '../../../src/ui/share-png';
import { SharePreview } from '../../../src/ui/SharePreview';

export interface ShareReceiptProps {
  readonly detail: ShareInput;
  /** Draws the image; the page's own canvas when absent. */
  readonly makeImage?: (markdown: string, theme: ShareTheme) => Promise<Blob>;
}

/**
 * Share a receipt (sprint_4 4.8; agents/ux_engineer.md rule 11): its redacted markdown (src/ui/receipt-share.ts) and
 * the image drawn from it, shown in full before either is copied. Nothing is sent anywhere.
 */
export function ShareReceipt({ detail, makeImage }: ShareReceiptProps) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="share-receipt-heading" class="space-y-1">
      <h3 id="share-receipt-heading" class="text-sm font-semibold">
        Share
      </h3>
      <p class="text-xs text-ink-muted">
        As text or an image: counterparties by domain only, a subject only as its hint, and never what you
        asked or why you marked it.
      </p>
      {open ? (
        <SharePreview
          markdown={receiptMarkdown(detail)}
          imageLabel="This receipt as an image"
          {...(makeImage === undefined ? {} : { makeImage })}
        />
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Share this receipt
        </Button>
      )}
    </section>
  );
}
