import { READERS } from '../../../src/config';
import { Skeleton } from '../../../src/ui/Skeleton';
import { LIVE_SETTINGS, type SettingsSources, useSettings } from '../use-settings';
import { AgentReaders } from './AgentReaders';
import { AutoCheckToggle } from './AutoCheckToggle';
import { ReaderRow } from './ReaderRow';
import { Section } from './Section';

export interface AdaptersSectionProps {
  /** Where the section reads and changes the readers; the ledger, storage and the bus when absent. */
  readonly sources?: SettingsSources;
  /** The instant "last checked" is written against; the page's clock when absent. */
  readonly nowMs?: () => number;
}

/**
 * The Adapters section (sprint_4 4.5): each page reader, on or off, with its observers' health (status, version, last
 * check) and the button that turns it off or on; Check Gmail for me, off unless turned on (4.9); then the agents'
 * readers, off under their makers' terms (3.10).
 */
export function AdaptersSection({ sources = LIVE_SETTINGS, nowMs = Date.now }: AdaptersSectionProps) {
  const state = useSettings(sources);
  return (
    <Section id="adapters">
      <p>
        The pages Attest reads, each only in tabs you open yourself, unless you turn on Check Gmail for me
        below. Turning a reader off stops it at once: a page you open afterwards is not read, and a tab
        already open stops at its next check.
      </p>
      {state.status === 'loading' ? <Skeleton rows={2} label="Loading the readers" /> : null}
      {state.status === 'failed' ? (
        <p role="alert" class="text-error-fg">
          Attest could not read its settings. Reload the page.
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <ul class="space-y-3">
            {READERS.map((reader) => (
              <ReaderRow
                key={reader}
                reader={reader}
                on={!state.view.readersOff.has(reader)}
                health={state.view.health}
                nowMs={nowMs()}
                toggle={(on) => sources.send({ type: 'reader.toggle', reader, on })}
              />
            ))}
          </ul>
          <AutoCheckToggle
            on={state.view.autoCheckGmail}
            gmailOn={!state.view.readersOff.has('gmail')}
            toggle={(on) => sources.send({ type: 'flag.set', flag: 'ATTEST_AUTO_CHECK_GMAIL', on })}
          />
        </>
      ) : null}
      <AgentReaders />
    </Section>
  );
}
