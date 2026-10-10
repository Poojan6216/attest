import { useState } from 'preact/hooks';

import type { SettingResult, TelemetrySendResult } from '../../../src/bus/messages';
import { sendTelemetryNow } from '../../../src/bus/send';
import { log } from '../../../src/log';
import { Button } from '../../../src/ui/Button';
import { onTelemetryChanged, previewTelemetry, type TelemetryView } from '../telemetry-preview';
import { useTelemetryView } from '../use-telemetry-view';
import { TelemetryPreview } from './TelemetryPreview';
import { TelemetryStatement } from './TelemetryStatement';

export interface TelemetrySources {
  /** The numbers for the last whole day, built from this ledger as the service worker builds them, and whether sent. */
  readonly preview: () => Promise<TelemetryView>;
  /** Calls `onChange` whenever the numbers may have changed (../telemetry-preview.ts); returns the unsubscribe. */
  readonly subscribe: (onChange: () => void) => () => void;
  /** Asks the service worker to send that day now (`telemetry.send`). */
  readonly sendNow: () => Promise<TelemetrySendResult>;
}

export const LIVE_TELEMETRY: TelemetrySources = {
  preview: () => previewTelemetry(Date.now()),
  subscribe: (onChange) => onTelemetryChanged(onChange),
  sendNow: sendTelemetryNow,
};

export interface TelemetryToggleProps {
  /** Whether telemetry is on (flag ATTEST_TELEMETRY). */
  readonly on: boolean;
  readonly toggle: (on: boolean) => Promise<SettingResult>;
  readonly sources?: TelemetrySources;
}

/** What one `telemetry.send` did, in one line. */
function sentLine(result: TelemetrySendResult): string {
  if (!result.ok) return 'Not sent. Try again.';
  const lines: Record<typeof result.outcome, string> = {
    sent: `Sent the numbers for ${result.day}.`,
    already_sent: `Already sent the numbers for ${result.day}: Attest sends one day once.`,
    off: 'Not sent: turn usage numbers on first.',
    not_built: `Not sent: Attest could not build the numbers for ${result.day}.`,
    failed: 'Not sent: the server did not take them. Attest tries again within the hour.',
  };
  return lines[result.outcome];
}

/**
 * The opt-in telemetry (sprint_5 5.7; src/telemetry/): off until the person turns it on (`flag.set` ATTEST_TELEMETRY).
 * It says what is sent, to whom, how often and how to stop, and shows the numbers for the last whole day, built from
 * this ledger as the service worker builds them (src/telemetry/aggregate.ts), read again on every change and after the
 * page's own command (Sprint 5 close, SEC-8). While it is on, "Send a test payload now" asks the service worker to send
 * that day now; each day goes once at most. A command that fails is said, never left busy (tech review TECH-6).
 */
export function TelemetryToggle({ on, toggle, sources = LIVE_TELEMETRY }: TelemetryToggleProps) {
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const { view, readAgain } = useTelemetryView(sources);
  const run = (task: () => Promise<string>): void => {
    setBusy(true);
    void task()
      .catch((error: unknown) => {
        log.warn('options.telemetry_command_failed', { error });
        return 'Not done. Try again.';
      })
      .then((said) => {
        setLine(said);
        setBusy(false);
        readAgain();
      });
  };
  const change = () => toggle(!on).then((result) => (result.ok ? '' : 'Not changed. Try again.'));
  const send = () => sources.sendNow().then(sentLine, () => 'Not sent. Try again.');
  return (
    <div role="group" aria-labelledby="telemetry-heading" class="space-y-2">
      <h3 id="telemetry-heading" class="font-semibold">
        Anonymous usage numbers
      </h3>
      <TelemetryStatement />
      <p role="status" class="text-sm">
        {on ? 'Usage numbers are on.' : 'Usage numbers are off.'}
      </p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => {
          run(change);
        }}
      >
        {on ? 'Turn off usage numbers' : 'Turn on usage numbers'}
      </Button>
      <TelemetryPreview view={view} />
      <Button
        variant="secondary"
        disabled={busy || !on}
        onClick={() => {
          run(send);
        }}
      >
        Send a test payload now
      </Button>
      {line === null || line === '' ? null : <p class="text-sm">{line}</p>}
    </div>
  );
}
