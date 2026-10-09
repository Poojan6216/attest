import { useState } from 'preact/hooks';

import { autoCheckWaitMs } from '../../../src/background/auto-check';
import type { SettingResult } from '../../../src/bus/messages';
import { DEFAULT_POLICY } from '../../../src/core/policy';
import { MS_PER_MINUTE } from '../../../src/core/units';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';

export interface AutoCheckToggleProps {
  /** Whether the Gmail auto-check is on (flag ATTEST_AUTO_CHECK_GMAIL). */
  readonly on: boolean;
  /** Whether the Gmail reader is on: the auto-check reads through it, and does nothing while it is off. */
  readonly gmailOn: boolean;
  readonly toggle: (on: boolean) => Promise<SettingResult>;
}

/** How long after Attest reads a claim it waits, and how long one open holds the next back, in the shipped policy. */
const WAIT_MINUTES = autoCheckWaitMs(DEFAULT_POLICY) / MS_PER_MINUTE;
const WINDOW_MINUTES = DEFAULT_POLICY.windows.graceMin;

type ToggleState = 'idle' | 'saving' | 'failed';

/**
 * Check Gmail for me (sprint_4 4.9; src/background/auto-check.ts): off until the person turns it on (`flag.set`). Its
 * text is where the one exception to Hard Rule 11 is told: what opens, when, how often, and that Attest only reads it.
 */
export function AutoCheckToggle({ on, gmailOn, toggle }: AutoCheckToggleProps) {
  const [state, setState] = useState<ToggleState>('idle');
  const change = (): void => {
    setState('saving');
    toggle(!on).then(
      (result) => {
        setState(result.ok ? 'idle' : 'failed');
      },
      (error: unknown) => {
        log.warn('options.auto_check_toggle_failed', { error });
        setState('failed');
      },
    );
  };
  return (
    <div role="group" aria-labelledby="auto-check-heading" class="space-y-2">
      <h3 id="auto-check-heading" class="font-semibold">
        Check Gmail for me
      </h3>
      <p class="text-sm">
        Off unless you turn it on. When an agent says it sent an email and no Gmail tab has shown Attest your
        Sent folder in the {WAIT_MINUTES} minutes since Attest read that claim, Attest opens your Gmail Sent
        folder itself: one tab, pinned and in front of you, never in the background. It opens at most one tab
        every {WINDOW_MINUTES} minutes, and never twice for the same claim.
      </p>
      <p class="text-sm">
        This is the only time Attest opens a page. It reads the folder as it does in any Gmail tab you open,
        and never acts on it. The popup says why the tab opened, and you can close it.
      </p>
      <p role="status" class="text-sm">
        {on ? 'Checking Gmail for you is on.' : 'Checking Gmail for you is off.'}
        {on && !gmailOn ? ' It does nothing while the Gmail reader is off.' : ''}
      </p>
      <Button variant="secondary" disabled={state === 'saving'} onClick={change}>
        {on ? 'Turn off checking Gmail' : 'Turn on checking Gmail'}
      </Button>
      {state === 'failed' ? (
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">
          Not changed. Try again.
        </p>
      ) : null}
    </div>
  );
}
