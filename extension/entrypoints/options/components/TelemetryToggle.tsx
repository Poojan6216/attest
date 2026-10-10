import { useCallback, useEffect, useState } from 'preact/hooks';

import type { SettingResult, TelemetrySendResult } from '../../../src/bus/messages';
import { sendTelemetryNow } from '../../../src/bus/send';
import { TELEMETRY_HOST } from '../../../src/config';
import { log } from '../../../src/log';
import type { TelemetryPayload } from '../../../src/telemetry/schema';
import { Button } from '../../../src/ui/Button';
import { previewTelemetry } from '../telemetry-preview';

export interface TelemetrySources {
  /** The payload the next send would carry, built from this ledger as the service worker builds it; null if none. */
  readonly preview: () => Promise<TelemetryPayload | null>;
  /** Asks the service worker to send that day now (`telemetry.send`). */
  readonly sendNow: () => Promise<TelemetrySendResult>;
}

export const LIVE_TELEMETRY: TelemetrySources = {
  preview: () => previewTelemetry(Date.now()),
  sendNow: sendTelemetryNow,
};

export interface TelemetryToggleProps {
  /** Whether telemetry is on (flag ATTEST_TELEMETRY). */
  readonly on: boolean;
  readonly toggle: (on: boolean) => Promise<SettingResult>;
  readonly sources?: TelemetrySources;
}

/** What is sent, to whom, how often, and how to stop. */
function TelemetryStatement() {
  return (
    <p class="text-sm">
      Off unless you turn it on. Once a day, Attest sends {TELEMETRY_HOST} the numbers below for the day
      before: how many receipts each agent got of each grade, which readers were on, how many hours they
      covered and whether they worked, a random install id (you can reset it below), the extension’s version,
      Chrome’s version and the date. Nothing else: never an address, a name, a subject or anything Attest
      read. Turn it off here at any time.
    </p>
  );
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

/** The payload the next send would carry, exactly. */
function TelemetryPreview({ payload }: { readonly payload: TelemetryPayload | null | undefined }) {
  if (payload === undefined) return <p class="text-sm">Reading the numbers the next send would hold.</p>;
  if (payload === null) return <p class="text-sm">Attest cannot build the numbers on this browser.</p>;
  return (
    <figure class="space-y-1">
      <figcaption class="text-sm">Exactly what the next send holds:</figcaption>
      <pre
        aria-label="The next send"
        data-verbatim=""
        tabIndex={0}
        class="max-h-64 overflow-auto rounded border border-rule p-2 text-xs"
      >
        {JSON.stringify(payload, null, 2)}
      </pre>
    </figure>
  );
}

/**
 * The opt-in telemetry (sprint_5 5.7; src/telemetry/): off until the person turns it on (`flag.set` ATTEST_TELEMETRY).
 * It says what is sent, to whom, how often and how to stop, and shows the payload the next send would carry, built from
 * this ledger as the service worker builds it (src/telemetry/aggregate.ts): what the person sees is exactly what goes.
 * While it is on, "Send a test payload now" asks the service worker to send that day now; each day goes once at most.
 */
export function TelemetryToggle({ on, toggle, sources = LIVE_TELEMETRY }: TelemetryToggleProps) {
  const [payload, setPayload] = useState<TelemetryPayload | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const read = useCallback(() => {
    sources.preview().then(setPayload, (error: unknown) => {
      log.warn('options.telemetry_preview_failed', { error });
      setPayload(null);
    });
  }, [sources]);
  useEffect(read, [read]);
  const run = (task: () => Promise<string>): void => {
    setBusy(true);
    void task().then((said) => {
      setLine(said);
      setBusy(false);
      read();
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
      <TelemetryPreview payload={payload} />
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
