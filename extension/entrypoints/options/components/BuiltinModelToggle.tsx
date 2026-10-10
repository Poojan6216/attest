import { useState } from 'preact/hooks';

import type { SettingResult } from '../../../src/bus/messages';
import type { BuiltinAvailability } from '../../../src/intel/providers/builtin';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import type { DownloadState } from '../use-builtin-model';
import { CheckModelButton } from './CheckModelButton';
import { ModelDownload } from './ModelDownload';
import { ModelStatement } from './ModelStatement';

export interface BuiltinModelToggleProps {
  /** Whether the on-device model is on (flag ATTEST_MODEL). */
  readonly on: boolean;
  /** Chrome's model here: `no_api` where it has no Prompt API, else null until the person asks (../use-builtin-model.ts). */
  readonly availability: BuiltinAvailability | null;
  /** Whether Chrome is being asked now. */
  readonly checking: boolean;
  readonly check: () => void;
  readonly download: DownloadState;
  readonly startDownload: () => void;
  readonly toggle: (on: boolean) => Promise<SettingResult>;
}

/** Why the model cannot be turned on yet, in one line, or null when it can. */
const WHY_NOT: Readonly<Record<Exclude<BuiltinAvailability, 'available'>, string>> = Object.freeze({
  no_api: 'This Chrome has no on-device model: it needs Chrome 138 or later on a computer that can run it.',
  unavailable: 'Chrome says this computer cannot run its on-device model.',
  downloadable: 'Chrome has not downloaded its on-device model yet.',
  downloading: 'Chrome is downloading its on-device model. Come back once it has finished.',
  unknown: 'Chrome did not answer. Check again.',
});

type ToggleState = 'idle' | 'saving' | 'failed';

/**
 * Chrome's on-device model (sprint_5 5.2, 5.4; src/intel/providers/builtin.ts): off until the person turns it on
 * (`flag.set`), which they can do once a check they asked for found Chrome has the model; otherwise the reason, in
 * one line. Chrome is asked only at their click, never as the page opens (../use-builtin-model.ts). Turning it off is
 * always possible. Its text says what it sees and that everything stays on this computer.
 */
export function BuiltinModelToggle(props: BuiltinModelToggleProps) {
  const { on, availability, checking, download } = props;
  const [state, setState] = useState<ToggleState>('idle');
  const change = (): void => {
    setState('saving');
    props.toggle(!on).then(
      (result) => {
        setState(result.ok ? 'idle' : 'failed');
      },
      (error: unknown) => {
        log.warn('options.model_toggle_failed', { error });
        setState('failed');
      },
    );
  };
  const usable = availability === 'available';
  const reason = availability === null || availability === 'available' ? null : WHY_NOT[availability];
  return (
    <div role="group" aria-labelledby="builtin-model-heading" class="space-y-2">
      <h3 id="builtin-model-heading" class="font-semibold">
        Chrome’s on-device model
      </h3>
      <ModelStatement />
      <p role="status" class="text-sm">
        {on ? 'The on-device model is on.' : 'The on-device model is off.'}
        {checking ? ' Checking whether Chrome has it.' : ''}
        {reason === null || checking ? '' : ` ${reason}`}
      </p>
      <CheckModelButton availability={availability} checking={checking} check={props.check} />
      <Button variant="secondary" disabled={state === 'saving' || (!on && !usable)} onClick={change}>
        {on ? 'Turn off the on-device model' : 'Turn on the on-device model'}
      </Button>
      {availability === 'downloadable' || download.status !== 'idle' ? (
        <ModelDownload download={download} startDownload={props.startDownload} />
      ) : null}
      {state === 'failed' ? (
        <p role="alert" class="text-sm text-error-fg">
          Not changed. Try again.
        </p>
      ) : null}
    </div>
  );
}
