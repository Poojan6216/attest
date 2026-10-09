import type { ReceiptInputs } from '../../../src/ledger/types';
import { inputFields } from '../../../src/ui/detail-labels';
import { Fields } from '../../../src/ui/Fields';
import { CoverageEntries } from './CoverageEntries';
import { DetailSection } from './DetailSection';

export interface DetailReadProps {
  readonly inputs: ReceiptInputs | undefined;
  readonly nowMs: number;
}

/** What a receipt's grading read: the grant in force, its context, and every coverage entry (its replay inputs). */
export function DetailRead({ inputs, nowMs }: DetailReadProps) {
  return (
    <DetailSection title="What the grading read">
      {inputs === undefined ? (
        <p class="text-xs text-ink-muted">Attest no longer keeps what this grading read.</p>
      ) : (
        <>
          <Fields fields={inputFields(inputs, nowMs)} />
          <CoverageEntries coverage={inputs.coverage} nowMs={nowMs} />
        </>
      )}
    </DetailSection>
  );
}
