import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { IDLE_PERMISSION } from '../../../src/config';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';

type AwayState = 'checking' | 'on' | 'off' | 'unknown';

/** What the status line says in each state (nothing while Chrome has not answered). */
const STATUS: Readonly<Record<AwayState, string>> = Object.freeze({
  checking: '',
  on: 'Away detection is on.',
  off: 'Away detection is off.',
  unknown: 'Attest could not tell whether away detection is on.',
});

const PERMISSION = { permissions: [IDLE_PERMISSION] };

/** Whether away detection is on (the permission is held), and turning it on or off. */
function useAway(): { state: AwayState; problem: string | null; change: (on: boolean) => void } {
  const [state, setState] = useState<AwayState>('checking');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    // A failure to tell is said, never read as on: Attest never assumes it may notice when you are away (Hard Rule 6).
    Promise.resolve()
      .then(() => browser.permissions.contains(PERMISSION))
      .then((held) => {
        setState(held ? 'on' : 'off');
      })
      .catch((error: unknown) => {
        log.warn('options.away_check_failed', { error });
        setState('unknown');
      });
  }, []);
  const change = (on: boolean) => {
    setProblem(null);
    // `request` must run inside the click (Chrome asks for a user gesture), so it is called here, not deferred.
    let asked: Promise<boolean>;
    try {
      asked = on ? browser.permissions.request(PERMISSION) : browser.permissions.remove(PERMISSION);
    } catch (error) {
      log.warn('options.away_change_failed', { error });
      setProblem('Something went wrong. Try again.');
      return;
    }
    asked
      .then((done) => {
        if (done) setState(on ? 'on' : 'off');
        else setProblem(on ? 'Chrome did not allow it, so it stays off.' : 'Chrome kept it on. Try again.');
      })
      .catch((error: unknown) => {
        log.warn('options.away_change_failed', { error });
        setProblem('Something went wrong. Try again.');
      });
  };
  return { state, problem, change };
}

/**
 * Away detection (sprint_3 3.14; src/background/idle.ts): off until the person turns it on, which asks Chrome for the
 * optional `idle` permission (Hard Rule 8); turning it off gives the permission back and deletes every stored time away.
 */
export function AwayDetection() {
  const { state, problem, change } = useAway();
  return (
    <div role="group" aria-labelledby="away-heading" class="space-y-2">
      <h3 id="away-heading" class="font-medium">
        When you are away
      </h3>
      <p>
        Attest can note when Chrome says you are away from this computer, so an action no claim explains can
        be put down to an agent that was working then, still as “likely”. It keeps only when each time away
        began and ended, in this browser, never what you did.
      </p>
      <p role="status">{STATUS[state]}</p>
      {(state === 'off' || state === 'unknown') && (
        <Button
          variant="secondary"
          onClick={() => {
            change(true);
          }}
        >
          Turn on
        </Button>
      )}
      {state === 'on' && (
        <Button
          variant="secondary"
          onClick={() => {
            change(false);
          }}
        >
          Turn off
        </Button>
      )}
      {problem !== null && (
        <p role="alert" class="text-red-800 dark:text-red-300">
          {problem}
        </p>
      )}
    </div>
  );
}
