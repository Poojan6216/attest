import { useState } from 'preact/hooks';

import type { DigestRecord } from '../../../src/ledger/types';
import { Button } from '../../../src/ui/Button';
import { digestMarkdown } from '../../../src/ui/digest-share';
import type { ShareTheme } from '../../../src/ui/share-png';
import { SharePreview } from '../../../src/ui/SharePreview';

/** What a share uses to copy and to draw; the page's own clipboard and canvas when absent. */
export interface ShareTools {
  readonly copy?: (text: string) => Promise<void>;
  readonly makeImage?: (markdown: string, theme: ShareTheme) => Promise<Blob>;
}

export interface ShareDigestProps extends ShareTools {
  readonly digest: DigestRecord;
}

/**
 * Share the week (sprint_4 4.7, 4.8; agents/ux_engineer.md rule 11): the redacted markdown (src/ui/digest-share.ts),
 * shown in full with its image before either is copied. Nothing is sent anywhere: the person copies it and decides
 * where it goes.
 */
export function ShareDigest({ digest, copy, makeImage }: ShareDigestProps) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="share-heading" class="space-y-2">
      <h2 id="share-heading" class="text-base font-semibold">
        Share
      </h2>
      <p>
        Share this week as text or as an image: counterparties by domain only, a subject only as its short
        hint. Read it before you copy it.
      </p>
      {open ? (
        <SharePreview
          markdown={digestMarkdown(digest)}
          imageLabel="This week as an image"
          {...(copy === undefined ? {} : { copyText: copy })}
          {...(makeImage === undefined ? {} : { makeImage })}
        />
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Share this week
        </Button>
      )}
    </section>
  );
}
