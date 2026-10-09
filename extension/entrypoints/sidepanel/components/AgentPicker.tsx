import type { RefObject } from 'preact';

import type { AgentId } from '../../../src/core/schema';
import { AGENT_NAMES, AGENT_ORDER } from '../../../src/ui/paste-labels';

export interface AgentPickerProps {
  readonly value: AgentId | null;
  readonly onChange: (agent: AgentId) => void;
  /** The first choice, which takes focus when the form opens. */
  readonly firstRef: RefObject<HTMLInputElement>;
}

/**
 * Whose log is pasted: one native radio per agent, so the arrow keys move within the group and a screen reader
 * names the group by its legend. None is chosen at first: a claim filed under the wrong agent would be graded
 * against the wrong grant.
 */
export function AgentPicker({ value, onChange, firstRef }: AgentPickerProps) {
  return (
    <fieldset>
      <legend class="font-medium">Which agent’s activity is this?</legend>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {AGENT_ORDER.map((agent, index) => (
          <label key={agent} class="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="paste-agent"
              value={agent}
              checked={value === agent}
              ref={index === 0 ? firstRef : null}
              onChange={() => {
                onChange(agent);
              }}
            />
            {AGENT_NAMES[agent]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
