import { useState } from 'preact/hooks';

import { type OverrideGrade, ReceiptOverride, SCHEMA_LIMITS } from '../../../src/core/schema';
import { Button } from '../../../src/ui/Button';
import type { Mark } from '../use-mark';
import { SaidLine } from './SaidLine';

export interface MarkFormProps {
  /** Sends the mark and says what came of it (OverrideControl's, so the line outlives this form). */
  readonly mark: Mark;
}

const CHOICES: readonly (readonly [OverrideGrade, string])[] = [
  ['VERIFIED', 'Verified: it happened'],
  ['NOT_FOUND', 'Not found: it did not happen'],
];

/**
 * A person's own mark on a receipt (sprint_4 4.3): Verified or Not found, with a reason they must give, at most 120
 * characters, checked with the receipt's own override schema before it is sent; an inline error says what is missing.
 */
export function MarkForm({ mark }: MarkFormProps) {
  const [grade, setGrade] = useState<OverrideGrade | null>(null);
  const [reason, setReason] = useState('');
  const { sending, said, say, send } = mark;
  const save = () => {
    if (grade === null) say({ kind: 'error', text: 'Choose Verified or Not found.' });
    else if (!ReceiptOverride.shape.reason.safeParse(reason).success)
      say({ kind: 'error', text: 'Say why, in a few words.' });
    else send({ kind: 'override', grade, reason }, 'Saved. Attest’s own grade stays beside your mark.');
  };
  return (
    <section aria-labelledby="mark-heading" class="space-y-2">
      <h3 id="mark-heading" class="text-sm font-semibold">
        Mark it yourself
      </h3>
      <fieldset class="space-y-1">
        <legend class="text-xs text-ink-muted">
          Your grade. Attest’s own stays beside it, and you can undo it.
        </legend>
        {CHOICES.map(([value, label]) => (
          <label key={value} class="flex items-center gap-2 text-xs text-ink">
            <input
              type="radio"
              name="mark-grade"
              checked={grade === value}
              onChange={() => {
                setGrade(value);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label for="mark-reason" class="block text-xs font-medium text-ink">
        Why
      </label>
      <textarea
        id="mark-reason"
        rows={2}
        maxLength={SCHEMA_LIMITS.ITEM}
        value={reason}
        onInput={(event) => {
          setReason(event.currentTarget.value);
        }}
        aria-describedby="mark-reason-hint"
        class="w-full rounded border border-rule bg-surface p-1 text-xs text-ink"
      />
      <p id="mark-reason-hint" class="text-xs text-ink-muted">
        Required, at most {SCHEMA_LIMITS.ITEM} characters ({SCHEMA_LIMITS.ITEM - reason.length} left). Your
        reason is kept with the receipt and never leaves your browser.
      </p>
      <Button variant="primary" onClick={save} disabled={sending}>
        Save my mark
      </Button>
      <SaidLine said={said} />
    </section>
  );
}
