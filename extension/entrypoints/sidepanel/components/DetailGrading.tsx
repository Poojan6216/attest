import type { Receipt } from '../../../src/core/schema';
import { gradingFields, reasonLines } from '../../../src/ui/detail-labels';
import { Fields } from '../../../src/ui/Fields';
import { DetailSection } from './DetailSection';

export interface DetailGradingProps {
  readonly receipt: Receipt;
  readonly nowMs: number;
}

/** How a receipt was graded: its grade, rule, confidence, score and every signal, its instants, and every reason. */
export function DetailGrading({ receipt, nowMs }: DetailGradingProps) {
  return (
    <DetailSection title="How it was graded">
      <Fields fields={gradingFields(receipt, nowMs)} />
      <ul aria-label="Reasons" class="list-disc space-y-0.5 pl-4 text-xs text-ink">
        {reasonLines(receipt).map((line, at) => (
          <li key={`${String(at)} ${line}`}>{line}</li>
        ))}
      </ul>
    </DetailSection>
  );
}
