import { useState } from 'preact/hooks';

import type { DigestRecord } from '../../../src/ledger/types';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import { digestMarkdown } from '../../../src/ui/digest-share';

export interface ShareDigestProps {
  readonly digest: DigestRecord;
  /** Puts the text on the clipboard; the page's own when absent. */
  readonly copy: (text: string) => Promise<void>;
}

type Copied = 'none' | 'copied' | 'failed';

/**
 * Share the week (sprint_4 4.7; agents/ux_engineer.md rule 11): the redacted markdown, shown in full before it is
 * copied (src/ui/digest-share.ts). Nothing is sent anywhere: the person copies the text and decides where it goes.
 */
export function ShareDigest({ digest, copy }: ShareDigestProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<Copied>('none');
  const text = digestMarkdown(digest);
  const copyText = (): void => {
    copy(text).then(
      () => {
        setCopied('copied');
      },
      (error: unknown) => {
        log.warn('digest.copy_failed', { error });
        setCopied('failed');
      },
    );
  };
  return (
    <section aria-labelledby="share-heading" class="space-y-2">
      <h2 id="share-heading" class="text-base font-semibold">
        Share
      </h2>
      <p>
        Share this week as text: counterparties by domain only, a subject only as its short hint. Read it
        before you copy it.
      </p>
      {open ? (
        <>
          <pre
            aria-label="What you would share"
            tabIndex={0}
            class="max-h-96 overflow-auto whitespace-pre-wrap rounded border border-rule p-row text-xs"
          >
            {text}
          </pre>
          <Button variant="primary" onClick={copyText}>
            Copy
          </Button>
          <p role="status" class="min-h-5">
            {copied === 'copied' ? 'Copied.' : ''}
            {copied === 'failed' ? 'Could not copy. Select the text and copy it yourself.' : ''}
          </p>
        </>
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
