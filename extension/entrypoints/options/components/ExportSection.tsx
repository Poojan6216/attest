import { useRef, useState } from 'preact/hooks';

import { exportLedgerFile, type SaveFile, saveJsonFile } from '../export-ledger';
import { Button } from '../../../src/ui/Button';
import { Section } from './Section';

export interface ExportSectionProps {
  /** Hands the file to the browser. The page saves through a download link; tests pass their own. */
  readonly save?: SaveFile;
}

type Outcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'exporting' }
  | { readonly kind: 'exported'; readonly fileName: string }
  | { readonly kind: 'failed' };

function statusOf(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'none':
      return '';
    case 'exporting':
      return 'Exporting…';
    case 'exported':
      return `Exported ${outcome.fileName}.`;
    case 'failed':
      return 'Could not export the ledger. Try again.';
  }
}

/**
 * Export: the whole ledger as one JSON file, made in this browser (Sprint 4.5 adds receipts as JSON and CSV). One
 * export at a time; the result is announced through `role="status"`.
 */
export function ExportSection({ save = saveJsonFile }: ExportSectionProps) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });
  const busy = useRef(false);

  const run = (): void => {
    if (busy.current) return;
    busy.current = true;
    setOutcome({ kind: 'exporting' });
    void exportLedgerFile(save).then((result) => {
      busy.current = false;
      setOutcome(result === null ? { kind: 'failed' } : { kind: 'exported', fileName: result.fileName });
    });
  };

  return (
    <Section id="export">
      <p>
        Save everything Attest keeps in this browser as one JSON file: the facts it read, when it looked, and
        whether each reader worked. The file is made on this computer and nothing is sent anywhere.
      </p>
      <div>
        <Button variant="secondary" onClick={run}>
          Export ledger
        </Button>
        <p role="status" class="mt-2 min-h-5">
          {statusOf(outcome)}
        </p>
      </div>
      <p class="text-neutral-600 dark:text-neutral-400">
        Receipts as JSON or CSV are available in a later version.
      </p>
    </Section>
  );
}
