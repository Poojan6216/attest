/**
 * The opt-in telemetry in the service worker (sprint_5 5.7; src/telemetry/send.ts): the hourly alarm's send, and the
 * options page's "Send a test payload now" (`telemetry.send`, which only an extension page may send). Both send the
 * last whole day, if telemetry is on and that day was not sent: the same one call, once a day at most. Nothing is sent
 * while telemetry is off (Hard Rule 1). A day sent is recorded in ledger meta (`telemetrySentDay`), which open pages
 * are told, so the options page's numbers say they went (Sprint 5 close, security review SEC-8).
 */
import type { LedgerTable, TelemetrySendResult } from '../bus/messages';
import { getLedger } from '../ledger/repo';
import { isLedgerLocked } from '../ledger/errors';
import { log } from '../log';
import { telemetryFacts } from '../telemetry/facts';
import { sendTelemetry } from '../telemetry/send';

type Notify = (tables: readonly LedgerTable[]) => void;

/** The hourly alarm (header); `notify` tells open pages when a day was sent. */
export async function runTelemetryAlarm(
  notify: Notify,
  nowMs: () => number = () => Date.now(),
): Promise<void> {
  const sent = await sendTelemetry({ db: await getLedger(), nowMs: nowMs(), facts: telemetryFacts });
  if (sent.outcome === 'sent') notify(['meta']);
  // On every path, `off` and `already_sent` among them: once an hour, it says the alarm's work is done (QA GAP 7).
  log.info('telemetry.alarm_done', { outcome: sent.outcome });
}

/** Handles one `telemetry.send` (header): what the send did, and the day it was about. */
export async function onTelemetrySend(
  notify: Notify,
  nowMs: () => number = () => Date.now(),
): Promise<TelemetrySendResult> {
  try {
    const sent = await sendTelemetry({ db: await getLedger(), nowMs: nowMs(), facts: telemetryFacts });
    if (sent.outcome === 'sent') notify(['meta']);
    return { ok: true, ...sent };
  } catch (error) {
    // Anything but the call itself (which send.ts logs as `telemetry.send_failed`): its own name (TECH-6). A locked
    // ledger is no failure (Sprint 6 close, tech review TECH-8): the numbers wait for the unlock.
    if (isLedgerLocked(error)) log.info('telemetry.locked');
    else log.error('telemetry.handler_failed', { error });
    return { ok: false, code: 'failed' };
  }
}
