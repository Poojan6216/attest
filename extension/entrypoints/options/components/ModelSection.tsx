import type { PromptApi } from '../../../src/intel/providers/builtin';
import { Skeleton } from '../../../src/ui/Skeleton';
import { PAGE_PROMPT_API, useBuiltinModel } from '../use-builtin-model';
import { LIVE_SETTINGS, type SettingsSources, useSettings } from '../use-settings';
import { BuiltinModelToggle } from './BuiltinModelToggle';
import { ByoModel } from './ByoModel';
import { Section } from './Section';

export interface ModelSectionProps {
  /** Where the section reads and changes the flag; the ledger and the bus when absent. */
  readonly sources?: SettingsSources;
  /** Chrome's Prompt API; the page's own when absent. */
  readonly promptApi?: () => PromptApi | null;
}

/**
 * The Model section (sprint_5 5.2): an optional model can suggest which items might match; it never decides a grade,
 * and it is off by default. Chrome's on-device model first (5.2); the person's own key second (5.3).
 */
export function ModelSection({ sources = LIVE_SETTINGS, promptApi = PAGE_PROMPT_API }: ModelSectionProps) {
  const state = useSettings(sources);
  const model = useBuiltinModel(promptApi);
  return (
    <Section id="model">
      <p>
        An optional model can suggest which items might match. It never decides a grade, and it is off by
        default.
      </p>
      {state.status === 'loading' ? <Skeleton rows={2} label="Loading the model settings" /> : null}
      {state.status === 'failed' ? (
        <p role="alert" class="text-error-fg">
          Attest could not read its settings. Reload the page.
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <>
          <BuiltinModelToggle
            on={state.view.modelOn}
            availability={model.availability}
            download={model.download}
            startDownload={model.startDownload}
            toggle={(on) => sources.send({ type: 'flag.set', flag: 'ATTEST_MODEL', on })}
          />
          <ByoModel on={state.view.modelByoOn} vendor={state.view.byoVendor} send={sources.send} />
        </>
      ) : null}
    </Section>
  );
}
