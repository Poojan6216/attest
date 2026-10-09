import { useState } from 'preact/hooks';

import type { SettingResult } from '../../../src/bus/messages';
import { OBSERVER_SITES, type ReaderId } from '../../../src/config';
import type { AdapterHealth } from '../../../src/ledger/types';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import { ObserverHealthLine } from './ObserverHealthLine';

export interface ReaderRowProps {
  readonly reader: ReaderId;
  readonly on: boolean;
  readonly health: readonly AdapterHealth[];
  readonly nowMs: number;
  readonly toggle: (on: boolean) => Promise<SettingResult>;
}

const READER_NAMES: Readonly<Record<ReaderId, string>> = Object.freeze({
  gmail: 'Gmail',
  gcal: 'Google Calendar',
});

const READS: Readonly<Record<ReaderId, string>> = Object.freeze({
  gmail: 'Reads your Sent folder and the receipts you open.',
  gcal: 'Reads the events your calendar shows.',
});

const observersOf = (reader: ReaderId): string[] =>
  Object.entries(OBSERVER_SITES)
    .filter(([, site]) => site === reader)
    .map(([observerId]) => observerId);

type ToggleState = 'idle' | 'saving' | 'failed';

/**
 * One page reader in the Adapters section (sprint_4 4.5): on or off, what it reads, each of its observers' health, and
 * the button that turns it off or on. Turned off, no page opened after reads it, and a tab already open stops at its
 * next check; the service worker does it (`reader.toggle`).
 */
export function ReaderRow({ reader, on, health, nowMs, toggle }: ReaderRowProps) {
  const [state, setState] = useState<ToggleState>('idle');
  const name = READER_NAMES[reader];
  const change = (): void => {
    setState('saving');
    toggle(!on).then(
      (result) => {
        setState(result.ok ? 'idle' : 'failed');
      },
      (error: unknown) => {
        log.warn('options.reader_toggle_failed', { error });
        setState('failed');
      },
    );
  };
  return (
    <li class="space-y-1 rounded border border-neutral-300 p-3 dark:border-neutral-700">
      <h3 class="font-semibold">
        {name} <span class="font-normal text-neutral-600 dark:text-neutral-400">{on ? 'On' : 'Off'}</span>
      </h3>
      <p class="text-sm">{on ? READS[reader] : `Off: Attest reads no ${name} page.`}</p>
      <ul class="space-y-1">
        {observersOf(reader).map((observerId) => (
          <ObserverHealthLine
            key={observerId}
            observerId={observerId}
            report={health.find((report) => report.adapterId === observerId)}
            nowMs={nowMs}
          />
        ))}
      </ul>
      <Button variant="secondary" disabled={state === 'saving'} onClick={change}>
        {on ? `Turn off ${name}` : `Turn on ${name}`}
      </Button>
      {state === 'failed' ? (
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">
          Not changed. Try again.
        </p>
      ) : null}
    </li>
  );
}
