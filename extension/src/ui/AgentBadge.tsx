import type { AgentId } from '../ledger/types';
import { agentName } from './receipt-labels';

export interface AgentBadgeProps {
  readonly agent: AgentId;
  /** An UNASKED receipt's agent is the likely one, never a certainty (Hard Rule 7): the badge says so. */
  readonly likely?: boolean;
}

/** Which agent a receipt is about, last in its row (agents/ux_engineer.md rules 1 and 4). */
export function AgentBadge({ agent, likely = false }: AgentBadgeProps) {
  return (
    <span class="inline-flex shrink-0 items-center whitespace-nowrap rounded border border-rule px-1.5 py-0.5 text-xs text-ink-muted">
      {likely ? `Likely agent: ${agentName(agent)}` : agentName(agent)}
    </span>
  );
}
