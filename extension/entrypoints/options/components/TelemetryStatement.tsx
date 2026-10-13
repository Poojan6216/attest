import { TELEMETRY_HOST } from '../../../src/config-network';

/**
 * What the usage numbers send, to whom, how often, what is published from them, and how to stop (sprint_5 5.7; Sprint
 * 7 close, privacy review gap 9: the published totals are said where the person turns the numbers on).
 */
export function TelemetryStatement() {
  return (
    <p class="text-sm">
      Off unless you turn it on. Once a day, Attest sends {TELEMETRY_HOST} the numbers below for the day
      before: how many receipts each agent got of each grade, which readers were on, how many hours they
      covered and whether they worked, a random install id (you can reset it below), the extension’s version,
      Chrome’s version and the date. Nothing else: never an address, a name, a subject or anything Attest
      read. Totals across all installs, a month at a time and never one install’s numbers, are published, and
      Attest’s monthly report on how often each agent’s claims checked out is written from them. Turn it off
      here at any time.
    </p>
  );
}
