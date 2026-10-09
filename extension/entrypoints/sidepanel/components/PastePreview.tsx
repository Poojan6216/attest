import type { RefObject } from 'preact';

import type { PastedEntry } from '../../../src/adapters/paste';
import { Button } from '../../../src/ui/Button';
import { AGENT_NAMES, count } from '../../../src/ui/paste-labels';
import type { PreviewStep } from '../use-paste-flow';
import { ClaimItem } from './ClaimItem';
import { SkippedItem, type SkippedItemProps } from './SkippedItem';

export interface PastePreviewProps {
  readonly preview: PreviewStep;
  readonly onImport: () => void;
  readonly onEdit: () => void;
  readonly onCancel: () => void;
  /** The heading, which takes focus when the preview opens so a screen reader starts here. */
  readonly headingRef: RefObject<HTMLHeadingElement>;
}

const isSkipped = (entry: PastedEntry): entry is SkippedItemProps['entry'] => entry.outcome !== 'claim';

/** The preview: each claim the log gives, each entry it does not and why, then Import, Edit the paste or Cancel. */
export function PastePreview({ preview, onImport, onEdit, onCancel, headingRef }: PastePreviewProps) {
  const { agent, log, importing, failed } = preview;
  const claims = count(log.claims.length, 'claim', 'claims');
  const skipped = log.entries.filter(isSkipped);
  return (
    <section aria-labelledby="paste-preview-heading" class="space-y-3">
      <h2 id="paste-preview-heading" ref={headingRef} tabIndex={-1} class="text-base font-semibold">
        Preview
      </h2>
      <p>
        {log.claims.length === 0
          ? `Nothing to import from ${AGENT_NAMES[agent]}.`
          : `${claims} to import from ${AGENT_NAMES[agent]}.`}
      </p>
      {log.claims.length > 0 && (
        <ul aria-label="Claims to import" class="space-y-2">
          {log.claims.map((claim) => (
            <ClaimItem key={claim.id} claim={claim} />
          ))}
        </ul>
      )}
      {skipped.length > 0 && (
        <div>
          <h3 id="paste-skipped-heading" class="font-medium">
            Not imported ({skipped.length})
          </h3>
          <ul aria-labelledby="paste-skipped-heading" class="mt-1 space-y-2">
            {skipped.map((entry, index) => (
              <SkippedItem key={index} entry={entry} />
            ))}
          </ul>
        </div>
      )}
      {failed && (
        <p role="alert" class="text-red-800 dark:text-red-300">
          Could not import the claims. Try again.
        </p>
      )}
      <div class="flex flex-wrap gap-2">
        {log.claims.length > 0 && (
          <Button variant="primary" disabled={importing} onClick={onImport}>
            {importing ? 'Importing' : `Import ${claims}`}
          </Button>
        )}
        <Button variant="secondary" disabled={importing} onClick={onEdit}>
          Edit the paste
        </Button>
        <Button variant="secondary" disabled={importing} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
