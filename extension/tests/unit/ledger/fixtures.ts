/**
 * Shared builders for the ledger specs. Every value is fixed (no clock, no randomness) so failures
 * reproduce. Import 'fake-indexeddb/auto' before this module (Dexie captures indexedDB at load).
 */
import 'fake-indexeddb/auto';

import { expect } from 'vitest';

import { LedgerError, type LedgerErrorCode } from '../../../src/ledger/errors';
import type {
  AdapterHealth,
  Claim,
  CoveragePing,
  Grant,
  Observation,
  Receipt,
  Request,
} from '../../../src/ledger/types';
import { setLogSink, type LogRecord } from '../../../src/log';

/** A valid ULID whose lexical order follows `n` (Crockford digits only). */
export function ulid(n: number): string {
  return `01JA${String(n).padStart(22, '0')}`;
}

/** A valid lowercase SHA-256 hex string derived from `n`. */
export function sha(n: number): string {
  return n.toString(16).padStart(64, '0');
}

let dbCounter = 0;

/** A database name no other test in the file uses. */
export function uniqueDbName(prefix: string): string {
  dbCounter += 1;
  return `attest-test-${prefix}-${String(dbCounter)}`;
}

export function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: ulid(1),
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'alice@example.com',
    subjectHint: 'Quarterly numbers',
    occurredAt: '2026-10-01T10:15:00-04:00',
    observedAt: '2026-10-01T10:20:00-04:00',
    contentHash: sha(1),
    ...overrides,
  };
}

export function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: ulid(101),
    agent: 'muse',
    requestId: ulid(201),
    type: 'email.sent',
    counterparty: 'alice@example.com',
    subjectHint: 'Quarterly numbers',
    claimedAt: '2026-10-01T10:14:00-04:00',
    observedAt: '2026-10-01T10:30:00-04:00',
    sourceKind: 'activity_view',
    extractor: { id: 'muse.activity', version: '1.0.0', confidence: 0.9 },
    rawHash: sha(101),
    ...overrides,
  };
}

export function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: ulid(201),
    agent: 'muse',
    conversationId: 'conv-1',
    textHint: 'Email Alice the quarterly numbers',
    textHash: sha(201),
    ts: '2026-10-01T10:00:00-04:00',
    ...overrides,
  };
}

export function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: ulid(301),
    claimId: ulid(101),
    observationIds: [ulid(1)],
    requestId: ulid(201),
    grade: 'VERIFIED',
    confidence: 0.92,
    ruleId: 'verified',
    reasons: ['Sent email found within the window'],
    signals: { timeProximity: 0.9, counterpartyExact: 1 },
    state: 'PENDING',
    inputsHash: sha(301),
    computedAt: '2026-10-01T10:31:00-04:00',
    ...overrides,
  };
}

export function makeGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    agent: 'muse',
    allowedTypes: ['email.sent', 'calendar.created'],
    counterpartyAllowlist: ['example.com'],
    spendCeilingCents: null,
    declaredScopes: ['gmail.send'],
    updatedAt: '2026-10-01T09:00:00-04:00',
    ...overrides,
  };
}

export function makeHealth(overrides: Partial<AdapterHealth> = {}): AdapterHealth {
  return {
    adapterId: 'muse',
    version: '1.0.0',
    status: 'OK',
    reasons: [],
    checkedAt: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

export function makePing(overrides: Partial<CoveragePing> = {}): CoveragePing {
  return {
    observerId: 'gmail',
    accountHash: sha(900),
    lastSyncAt: '2026-10-01T10:00:00Z',
    windowStart: '2026-10-01T09:00:00Z',
    windowEnd: '2026-10-01T10:00:00Z',
    userActive: true,
    ...overrides,
  };
}

/** A copy of `value` without `key`: builds objects that omit an optional field. */
export function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const kept = Object.entries(value).filter(([name]) => name !== key);
  return Object.fromEntries(kept) as Omit<T, K>;
}

/** Routes log records into an array until `restore()` is called. */
export function captureLogs(): { records: LogRecord[]; restore: () => void } {
  const records: LogRecord[] = [];
  const restore = setLogSink((record) => {
    records.push(record);
  });
  return { records, restore };
}

/** Awaits a promise that must reject with a LedgerError of `code`, and returns that error. */
export async function expectLedgerError(
  promise: Promise<unknown>,
  code: LedgerErrorCode,
): Promise<LedgerError> {
  const outcome = await promise.then(
    () => ({ rejected: false as const }),
    (error: unknown) => ({ rejected: true as const, error }),
  );
  if (!outcome.rejected) throw new Error(`expected a LedgerError(${code}) but the promise resolved`);
  expect(outcome.error).toBeInstanceOf(LedgerError);
  if (!(outcome.error instanceof LedgerError)) throw new Error('not a LedgerError');
  expect(outcome.error.code).toBe(code);
  return outcome.error;
}
