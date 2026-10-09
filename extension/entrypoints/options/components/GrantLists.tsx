import type { AgentId } from '../../../src/core/schema';
import type { DraftField, GrantDraft } from '../../../src/ui/grant-form';
import { CeilingField } from './CeilingField';
import { GrantTextField } from './GrantTextField';

export interface GrantListsProps {
  readonly agent: AgentId;
  readonly draft: GrantDraft;
  readonly errors: Readonly<Partial<Record<DraftField, string>>>;
  readonly edit: (change: Partial<GrantDraft>) => void;
}

/** A grant's recipients, spend ceiling and declared access, each with its hint and what to fix. */
export function GrantLists({ agent, draft, errors, edit }: GrantListsProps) {
  return (
    <>
      <GrantTextField
        id={`${agent}-recipients`}
        label="May write to"
        hint="One domain (company.com) or address (priya@company.com) per line. Leave it empty for anyone."
        value={draft.recipients}
        error={errors.recipients}
        onInput={(recipients) => {
          edit({ recipients });
        }}
      />
      <CeilingField
        id={`${agent}-ceiling`}
        ceiling={draft.ceiling}
        currency={draft.currency}
        error={errors.ceiling}
        onChange={(ceiling, currency) => {
          edit({ ceiling, currency });
        }}
      />
      <GrantTextField
        id={`${agent}-access`}
        label="Declared access"
        hint="What you gave it access to, one per line, such as gmail.send."
        value={draft.access}
        error={errors.access}
        onInput={(access) => {
          edit({ access });
        }}
      />
    </>
  );
}
