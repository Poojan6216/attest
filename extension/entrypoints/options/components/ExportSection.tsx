import { useRef, useState } from 'preact/hooks';

import { type ExportKind, exportFile, type SaveFile, saveFile } from '../export-ledger';
import { Button } from '../../../src/ui/Button';
import { Section } from './Section';

export interface ExportSectionProps {
  /** Hands the file to the browser. The page saves through a download link; tests pass their own. */
  readonly save?: SaveFile;
  /** The export's instant, ISO 8601 with an offset. The page's clock; tests pass their own. */
  readonly clock?: () => string;
}

type Outcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'exporting' }
  | { readonly kind: 'exported'; readonly fileName: string }
  | { readonly kind: 'failed'; readonly what: ExportKind };

const FAILED: Readonly<Record<ExportKind, string>> = {
  ledger: 'Could not export the ledger. Try again.',
  receipts: 'Could not export the receipts. Try again.',
};

function statusOf(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'none':
      return '';
    case 'exporting':
      return 'Exporting…';
    case 'exported':
      return `Exported ${outcome.fileName}.`;
    case 'failed':
      return FAILED[outcome.what];
  }
}

/**
 * Export (sprint_4 4.5): the whole ledger as one JSON file, or the receipts as one CSV file, each made in this page.
 * One export at a time; the result is announced through `role="status"`.
 */
export function ExportSection({ save = saveFile, clock }: ExportSectionProps) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });
  const busy = useRef(false);

  const run = (what: ExportKind): void => {
    if (busy.current) return;
    busy.current = true;
    setOutcome({ kind: 'exporting' });
    void exportFile(what, save, clock).then((result) => {
      busy.current = false;
      setOutcome(
        result === null ? { kind: 'failed', what } : { kind: 'exported', fileName: result.fileName },
      );
    });
  };

  return (
    <Section id="export">
      <p>
        Save everything Attest keeps in this browser as one JSON file: the facts it read, when it looked,
        whether each reader worked, and every receipt with what it was graded on.
      </p>
      <p>
        Or save your receipts as a CSV file for a spreadsheet: one line per receipt, newest first, with its
        grade and the action it is about.
      </p>
      <p>Each file is made on this computer, and nothing is sent anywhere.</p>
      <div>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              run('ledger');
            }}
          >
            Export ledger
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              run('receipts');
            }}
          >
            Export receipts
          </Button>
        </div>
        <p role="status" class="mt-2 min-h-5">
          {statusOf(outcome)}
        </p>
      </div>
    </Section>
  );
}
