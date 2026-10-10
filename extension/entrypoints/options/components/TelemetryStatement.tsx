import { TELEMETRY_HOST } from '../../../src/config';

/** What the usage numbers send, to whom, how often, and how to stop (sprint_5 5.7). */
export function TelemetryStatement() {
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
