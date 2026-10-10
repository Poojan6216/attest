/**
 * The telemetry payload the next send would carry (sprint_5 5.7), built in the options page from its own connection to
 * the ledger (src/ledger/shared.ts) with the same builder and facts the service worker sends with
 * (src/telemetry/aggregate.ts, src/telemetry/facts.ts): the page shows exactly what goes, and sends nothing itself. It
 * reads the install id and never makes one: with none stored, there is nothing to show.
 */
import { readInstallId } from '../../src/ledger/install-id';
import { getLedger } from '../../src/ledger/shared';
import { buildTelemetry, reportedDay } from '../../src/telemetry/aggregate';
import { telemetryFacts } from '../../src/telemetry/facts';
import type { TelemetryPayload } from '../../src/telemetry/schema';

/** The payload for the last whole day before `nowMs` (header), or null when none can be built here. */
export async function previewTelemetry(nowMs: number): Promise<TelemetryPayload | null> {
  const facts = await telemetryFacts(readInstallId);
  return facts === null ? null : buildTelemetry(await getLedger(), facts, reportedDay(nowMs));
}
