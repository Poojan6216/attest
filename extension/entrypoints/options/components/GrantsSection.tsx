import { AgentId } from '../../../src/core/schema';
import { Skeleton } from '../../../src/ui/Skeleton';
import { type GrantSources, LIVE_GRANTS, useGrantSettings } from '../use-grant-settings';
import { AgentGrantForm } from './AgentGrantForm';
import { Section } from './Section';

export interface GrantsSectionProps {
  /** Where the section reads and saves; the ledger and the bus when absent. */
  readonly sources?: GrantSources;
}

/**
 * The options page's Grants (sprint_4 4.4): what each agent may do, one form per agent. An agent with no grant yet
 * shows the default one, every action allowed, which applies until it is saved.
 */
export function GrantsSection({ sources = LIVE_GRANTS }: GrantsSectionProps) {
  const state = useGrantSettings(sources);
  return (
    <Section id="grants">
      <p>
        Set what each agent may do. Attest grades a claim OVER SCOPE when it goes beyond its grant. A change
        applies to the agent’s open receipts at once; a final receipt never changes.
      </p>
      {state.status === 'loading' ? <Skeleton rows={4} label="Loading the grants" /> : null}
      {state.status === 'failed' ? (
        <p role="alert" class="text-red-700 dark:text-red-300">
          Attest could not read the grants. Reload the page.
        </p>
      ) : null}
      {state.status === 'ready'
        ? AgentId.options.map((agent) => (
            <AgentGrantForm
              key={agent}
              agent={agent}
              stored={state.settings.grants.find((grant) => grant.agent === agent)}
              muted={state.settings.muted[agent] === true}
              save={sources.save}
            />
          ))
        : null}
    </Section>
  );
}
