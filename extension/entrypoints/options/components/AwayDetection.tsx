import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { IDLE_PERMISSION } from '../../../src/config';
import { Button } from '../../../src/ui/Button';

type AwayState = 'checking' | 'on' | 'off';

const PERMISSION = { permissions: [IDLE_PERMISSION] };

/** Whether away detection is on (the permission is held), and turning it on or off. */
function useAway(): { state: AwayState; problem: string | null; change: (on: boolean) => void } {
  const [state, setState] = useState<AwayState>('checking');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    // Any failure to tell reads as off: Attest never assumes it may notice when you are away.
    Promise.resolve()
      .then(() => browser.permissions.contains(PERMISSION))
      .then((held) => {
        setState(held ? 'on' : 'off');
      })
      .catch(() => {
        setState('off');
      });
  }, []);
  const change = (on: boolean) => {
    setProblem(null);
    // `request` must run inside the click (Chrome asks for a user gesture), so it is called here, not deferred.
    let asked: Promise<boolean>;
    try {
      asked = on ? browser.permissions.request(PERMISSION) : browser.permissions.remove(PERMISSION);
    } catch {
      setProblem('Something went wrong. Try again.');
      return;
    }
    asked
      .then((done) => {
        if (done) setState(on ? 'on' : 'off');
        else setProblem(on ? 'Chrome did not allow it, so it stays off.' : 'Chrome kept it on. Try again.');
      })
      .catch(() => {
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
      <p role="status">{state === 'checking' ? '' : `Away detection is ${state}.`}</p>
      {state === 'off' && (
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
