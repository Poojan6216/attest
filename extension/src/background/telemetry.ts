/**
 * The opt-in telemetry in the service worker (sprint_5 5.7; src/telemetry/send.ts): the hourly alarm's send, and the
 * options page's "Send a test payload now" (`telemetry.send`, which only an extension page may send). Both send the
 * last whole day, if telemetry is on and that day was not sent: the same one call, once a day at most. Nothing is sent
 * while telemetry is off (Hard Rule 1).
 */
import type { TelemetrySendResult } from '../bus/messages';
import { getLedger } from '../ledger/repo';
import { log } from '../log';
import { telemetryFacts } from '../telemetry/facts';
import { sendTelemetry } from '../telemetry/send';

/** The hourly alarm (header). */
export async function runTelemetryAlarm(nowMs: () => number = () => Date.now()): Promise<void> {
  await sendTelemetry({ db: await getLedger(), nowMs: nowMs(), facts: telemetryFacts });
}

/** Handles one `telemetry.send` (header): what the send did, and the day it was about. */
export async function onTelemetrySend(nowMs: () => number = () => Date.now()): Promise<TelemetrySendResult> {
  try {
    const sent = await sendTelemetry({ db: await getLedger(), nowMs: nowMs(), facts: telemetryFacts });
    return { ok: true, ...sent };
  } catch (error) {
    log.error('telemetry.send_failed', { error });
    return { ok: false, code: 'failed' };
  }
}
