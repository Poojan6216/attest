import { Fragment } from 'preact';

import type { Field } from './detail-labels';

export interface FieldsProps {
  readonly fields: readonly Field[];
}

/** Labelled values as a definition list (a receipt's detail, sprint_4 4.3): each label, then its stored value. */
export function Fields({ fields }: FieldsProps) {
  return (
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {fields.map(([label, value]) => (
        <Fragment key={label}>
          <dt class="text-ink-muted">{label}</dt>
          <dd class="break-words text-ink">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
