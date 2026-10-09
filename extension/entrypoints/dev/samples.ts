/**
 * Invented data for the components page (sprint_4 4.1): no value here came from any page or account. Times are set
 * relative to the moment the page opens, so "checked" and "not checked since" read as they would in the popup. Each
 * value is parsed with its ledger schema, so the page shows only what the ledger could hold.
 */
import { idFromHash } from '../../src/core/hash';
import { contentHashOf } from '../../src/core/redact';
import { AdapterHealth, CoveragePing, IsoTs, Observation } from '../../src/ledger/types';
import type { CoverageSummary } from '../../src/ledger/views';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const iso = (ms: number): IsoTs => IsoTs.parse(new Date(ms).toISOString());

/** An observation sealed as the observers seal one: its content hashed, its id from that hash. */
function observation(content: Readonly<Record<string, unknown>>): Observation {
  const contentHash = contentHashOf(content);
  return Observation.parse({ ...content, contentHash, id: idFromHash(contentHash) });
}

export interface Samples {
  /** Every source checked in the last minutes, and Muse's activity added. */
  readonly covered: CoverageSummary;
  /** Gmail Sent last checked hours ago, Calendar and Gmail receipts never. */
  readonly gaps: CoverageSummary;
  /** The Gmail Sent reader degraded, the Calendar reader well. */
  readonly health: readonly AdapterHealth[];
  /** A sent email, a created event and an order email, one first seen before it was stored. */
  readonly evidence: readonly Observation[];
}

/** A ping of `source` last synced at `syncMs`, its window the six hours before it. */
function ping(source: 'gmail.sent' | 'gmail.receipt' | 'gcal.event', syncMs: number): CoveragePing {
  return CoveragePing.parse({
    observerId: source,
    source,
    ...(source === 'gcal.event' ? { allCalendars: true } : {}),
    userActive: source !== 'gcal.event',
    lastSyncAt: iso(syncMs),
    windowStart: iso(syncMs - 6 * HOUR),
    windowEnd: iso(syncMs),
  });
}

function healthSamples(nowMs: number): AdapterHealth[] {
  const checkedAt = iso(nowMs - MINUTE);
  return [
    AdapterHealth.parse({
      adapterId: 'gmail.sent',
      version: '1.5.0',
      status: 'DEGRADED',
      reasons: ['not_sent_folder'],
      checkedAt,
    }),
    AdapterHealth.parse({ adapterId: 'gcal.event', version: '1.5.0', status: 'OK', reasons: [], checkedAt }),
  ];
}

function evidenceSamples(nowMs: number): Observation[] {
  return [
    observation({
      source: 'gmail.sent',
      type: 'email.sent',
      counterparty: 'priya@example.com',
      subjectHint: 'Q3 deck',
      occurredAt: iso(nowMs - 30 * MINUTE),
      observedAt: iso(nowMs - 29 * MINUTE),
      rowKeyHash: 'ab'.repeat(32),
    }),
    observation({
      source: 'gcal.event',
      type: 'calendar.created',
      counterparty: 'sam@example.com',
      subjectHint: 'Design review',
      occurredAt: iso(nowMs + 26 * HOUR),
      observedAt: iso(nowMs - 40 * MINUTE),
      sightedAt: iso(nowMs - 45 * MINUTE),
      rowKeyHash: 'cd'.repeat(32),
    }),
    observation({
      source: 'gmail.receipt',
      type: 'purchase.made',
      merchant: 'Blue Bottle',
      amountCents: 1250,
      currency: 'USD',
      subjectHint: 'Your order',
      occurredAt: iso(nowMs - 2 * HOUR),
      observedAt: iso(nowMs - 2 * HOUR + MINUTE),
      rowKeyHash: 'ef'.repeat(32),
    }),
  ];
}

export function samples(nowMs: number): Samples {
  return {
    covered: {
      coverage: [
        ping('gcal.event', nowMs - 8 * MINUTE),
        ping('gmail.receipt', nowMs - 2 * MINUTE),
        ping('gmail.sent', nowMs - 2 * MINUTE),
      ],
      imports: { muse: iso(nowMs - 20 * MINUTE) },
    },
    gaps: { coverage: [ping('gmail.sent', nowMs - 3 * HOUR)], imports: {} },
    health: healthSamples(nowMs),
    evidence: evidenceSamples(nowMs),
  };
}
