import { useState } from 'preact/hooks';

import type { SettingResult } from '../../../src/bus/messages';
import type { BuiltinAvailability } from '../../../src/intel/providers/builtin';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import type { DownloadState } from '../use-builtin-model';

export interface BuiltinModelToggleProps {
  /** Whether the on-device model is on (flag ATTEST_MODEL). */
  readonly on: boolean;
  /** Chrome's model here; null while it is being read. */
  readonly availability: BuiltinAvailability | null;
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
});

type ToggleState = 'idle' | 'saving' | 'failed';

/** What the model sees, where it runs, and what it may do to a grade. */
function ModelStatement() {
  return (
    <>
      <p class="text-sm">
        Off unless you turn it on. The model runs on this computer, inside Chrome: nothing is sent anywhere.
        For each claim it sees only what kind of action it was, who it was to, its short subject, its amount
        and its time, and the same for each item that might match. It never sees a page or what you asked an
        agent.
      </p>
      <p class="text-sm">
        It never decides a grade. It can only move a partial match toward verified, and never lowers a grade.
      </p>
    </>
  );
}

/** The download a person may start with a click, its progress, and its failure. */
function ModelDownload({
  download,
  startDownload,
}: Pick<BuiltinModelToggleProps, 'download' | 'startDownload'>) {
  return (
    <>
      <Button variant="secondary" disabled={download.status === 'downloading'} onClick={startDownload}>
        Download Chrome’s on-device model
      </Button>
      {download.status === 'downloading' ? (
        <p role="status" class="text-sm">
          Chrome is downloading its model: {Math.round(download.loaded * 100)}% so far.
        </p>
      ) : null}
      {download.status === 'failed' ? (
        <p role="alert" class="text-sm text-error-fg">
          Chrome did not download its model. Try again later.
        </p>
      ) : null}
    </>
  );
}

/**
 * Chrome's on-device model (sprint_5 5.2; src/intel/providers/builtin.ts): off until the person turns it on
 * (`flag.set`), and only where Chrome has the model; otherwise the reason, in one line. Turning it off is always
 * possible. Its text says what it sees and that everything stays on this computer.
 */
export function BuiltinModelToggle(props: BuiltinModelToggleProps) {
  const { on, availability, download } = props;
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
        {availability === null ? ' Checking whether Chrome has it.' : ''}
        {reason === null ? '' : ` ${reason}`}
      </p>
      <Button
        variant="secondary"
        disabled={state === 'saving' || availability === null || (!on && !usable)}
        onClick={change}
      >
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
