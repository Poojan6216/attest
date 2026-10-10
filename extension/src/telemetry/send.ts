/**
 * The opt-in telemetry's one call (sprint_5 5.7; agents/extension_engineer.md rule 6; Hard Rule 1): while the person has
 * telemetry on (flag ATTEST_TELEMETRY), the last whole day's payload (./aggregate.ts), at most once a day, POSTed to
 * TELEMETRY_ENDPOINT and nowhere else. It is the extension's one call besides the person's own model key's
 * (eslint-rules/fences.js NETWORK_EXEMPT_FILES; tests/e2e/built-bundle.spec.ts). No cookie, no referrer, no cache. A day
 * is recorded as sent only once the API took it (204), so a day it did not take is tried again at the next alarm; and
 * one send runs at a time, so the hourly alarm and the options page's button never send a day twice. The log says what
 * happened and the HTTP status, never the payload (Hard Rule 10).
 */
import { TELEMETRY_ENDPOINT } from '../config';
import { readFlags } from '../ledger/consent';
import type { LedgerDb } from '../ledger/db';
import { recordTelemetrySent, telemetrySentDay } from '../ledger/telemetry-sent';
import { log } from '../log';
import { buildTelemetry, reportedDay, type TelemetryFacts } from './aggregate';

/** What a send did: nothing (telemetry off, the day already sent, no payload to build), sent, or failed. */
export type TelemetryOutcome = 'off' | 'already_sent' | 'not_built' | 'sent' | 'failed';

export interface TelemetrySent {
  readonly outcome: TelemetryOutcome;
  /** The day it was about, `YYYY-MM-DD`. */
  readonly day: string;
}

export interface TelemetrySendDeps {
  readonly db: LedgerDb;
  readonly nowMs: number;
  /** The install id and the versions; null when there is no install id to send. */
  readonly facts: () => Promise<TelemetryFacts | null>;
  /** The POST (header); `post` below when absent. */
  readonly post?: (body: string) => Promise<Response>;
}

/** The extension's one telemetry call (header), written out. */
function post(body: string): Promise<Response> {
  return fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
}

/** One send (header). */
async function sendOnce(deps: TelemetrySendDeps): Promise<TelemetrySent> {
  const day = reportedDay(deps.nowMs);
  const about = (outcome: TelemetryOutcome): TelemetrySent => ({ outcome, day: day.bucket });
  if (!(await readFlags(deps.db)).ATTEST_TELEMETRY) return about('off');
  const sent = await telemetrySentDay(deps.db);
  if (sent !== null && sent >= day.bucket) return about('already_sent');
  const facts = await deps.facts();
  const payload = facts === null ? null : await buildTelemetry(deps.db, facts, day);
  if (payload === null) {
    log.warn('telemetry.not_built');
    return about('not_built');
  }
  let response: Response;
  try {
    response = await (deps.post ?? post)(JSON.stringify(payload));
  } catch (error) {
    log.warn('telemetry.send_failed', { error });
    return about('failed');
  }
  if (response.status !== 204) {
    log.warn('telemetry.refused', { status: response.status });
    return about('failed');
  }
  await recordTelemetrySent(deps.db, day.bucket);
  log.info('telemetry.sent');
  return about('sent');
}

let running: Promise<TelemetrySent> | null = null;

/** Sends the last whole day's payload if it is due (header); a call while one runs gets that one's answer. */
export function sendTelemetry(deps: TelemetrySendDeps): Promise<TelemetrySent> {
  running ??= sendOnce(deps).finally(() => {
    running = null;
  });
  return running;
}
