import { ActionType, type AgentId, type Grant } from '../../../src/core/schema';
import { Button } from '../../../src/ui/Button';
import { CheckGroup } from '../../../src/ui/CheckGroup';
import { grantOfDraft, grantSentence } from '../../../src/ui/grant-form';
import { AGENT_NAMES, claimTypeLabel } from '../../../src/ui/paste-labels';
import { useGrantDraft } from '../use-grant-draft';
import type { GrantSources } from '../use-grant-settings';
import { GrantLists } from './GrantLists';
import { SaveLine } from './SaveLine';

export interface AgentGrantFormProps {
  readonly agent: AgentId;
  /** The agent's stored grant; the default (every action) when it has none yet. */
  readonly stored: Grant | undefined;
  readonly muted: boolean;
  readonly save: GrantSources['save'];
}

const ACTIONS = ActionType.options.map((type) => [type, claimTypeLabel(type)] as const);

/**
 * One agent's grant (sprint_4 4.4; agents/ux_engineer.md rule 7): what it may do in plain language, its actions, the
 * recipients it may write to, its spend ceiling, its declared access, and whether its alerts are muted. Checked when
 * saved, each field saying what to fix; an explicit Save. A saved grant applies to the agent's open receipts at once,
 * never to a final one.
 */
export function AgentGrantForm({ agent, stored, muted, save }: AgentGrantFormProps) {
  const { draft, edit, errors, state, submit } = useGrantDraft(agent, stored, muted, save);
  const name = AGENT_NAMES[agent];
  const made = grantOfDraft(agent, draft);
  return (
    <section
      aria-labelledby={`${agent}-grant`}
      class="space-y-3 rounded border border-neutral-300 p-3 dark:border-neutral-700"
    >
      <h3 id={`${agent}-grant`} class="font-semibold">
        {name}
      </h3>
      <p class="text-sm">
        {made.ok ? grantSentence(name, made.grant) : `${name}: fix the fields below to see what it may do.`}
      </p>
      <CheckGroup
        legend="May do"
        options={ACTIONS}
        checked={(type) => draft.allowedTypes.includes(type)}
        onToggle={(type) => {
          const on = !draft.allowedTypes.includes(type);
          edit({
            allowedTypes: ActionType.options.filter((each) =>
              each === type ? on : draft.allowedTypes.includes(each),
            ),
          });
        }}
      />
      <GrantLists agent={agent} draft={draft} errors={errors} edit={edit} />
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.muted}
          onChange={() => {
            edit({ muted: !draft.muted });
          }}
        />
        Mute alerts for {name}
      </label>
      <div class="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={submit} disabled={state === 'saving'}>
          Save {name}’s grant
        </Button>
        <SaveLine state={state} />
      </div>
    </section>
  );
}
