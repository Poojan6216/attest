/**
 * Shared builders for the ledger specs. Every value is fixed (no clock, no randomness) so failures
 * reproduce. Import 'fake-indexeddb/auto' before this module (Dexie captures indexedDB at load).
 *
 * Builders return the schemas' *input* types (plain strings, no brands): that is what the repos accept, and
 * it lets a test build an invalid value through an override. A test that needs the parsed, branded domain
 * object (a row builder, a strict equality on a parse) parses the builder's result with the schema.
 */
import 'fake-indexeddb/auto';

import { expect } from 'vitest';

import { idFromHash } from '../../../src/core/hash';
import { LedgerError, type LedgerErrorCode } from '../../../src/ledger/errors';
import type {
  AdapterHealthInput,
  ClaimInput,
  CoveragePingInput,
  GrantInput,
  ObservationInput,
  ReceiptInput,
  RequestInput,
} from '../../../src/ledger/types';
import { setLogSink, type LogRecord } from '../../../src/log';

/** A valid ULID whose lexical order follows `n` (Crockford digits only). */
export function ulid(n: number): string {
  return `01JA${String(n).padStart(22, '0')}`;
}

/**
 * A valid lowercase SHA-256 hex string derived from `n`. `n` is written in both halves, so the first 128 bits
 * differ per `n` and `idFromHash(sha(n))` (which reads only those bits, §10) is distinct per `n` too.
 */
export function sha(n: number): string {
  return n.toString(16).padStart(32, '0').repeat(2);
}

/** The id of the observation whose contentHash is `sha(n)`: §10 (v1.3) `id = idFromHash(contentHash)`. */
export function observationId(n: number): string {
  return idFromHash(sha(n));
}

/** The id of the claim whose rawHash is `sha(n)`: §8, §10 (v1.4) `id = idFromHash(rawHash)`. */
export function claimId(n: number): string {
  return idFromHash(sha(n));
}

const HEX_SHA256 = /^[0-9a-f]{64}$/;

let dbCounter = 0;

/** A database name no other test in the file uses. */
export function uniqueDbName(prefix: string): string {
  dbCounter += 1;
  return `attest-test-${prefix}-${String(dbCounter)}`;
}

/**
 * A valid observation: contentHash `sha(1)` unless overridden, and an id derived from whatever contentHash it
 * ends up with (the schema checks `id = idFromHash(contentHash)`, §10 v1.3). Overriding `id` builds an
 * observation whose id does not match, which the schema rejects.
 */
export function makeObservation(overrides: Partial<ObservationInput> = {}): ObservationInput {
  const contentHash = overrides.contentHash ?? sha(1);
  return {
    id: HEX_SHA256.test(contentHash) ? idFromHash(contentHash) : observationId(1),
    source: 'gmail.sent',
    type: 'email.sent',
    counterparty: 'alice@example.com',
    subjectHint: 'Quarterly numbers',
    occurredAt: '2026-10-01T10:15:00-04:00',
    observedAt: '2026-10-01T10:20:00-04:00',
    contentHash,
    ...overrides,
  };
}

/**
 * A valid claim: rawHash `sha(101)` unless overridden, and an id derived from whatever rawHash it ends up with
 * (the schema checks `id = idFromHash(rawHash)`, §10 v1.4). Overriding `id` builds a claim whose id does not
 * match, which the schema rejects.
 */
export function makeClaim(overrides: Partial<ClaimInput> = {}): ClaimInput {
  const rawHash = overrides.rawHash ?? sha(101);
  return {
    id: HEX_SHA256.test(rawHash) ? idFromHash(rawHash) : claimId(101),
    agent: 'muse',
    requestId: ulid(201),
    type: 'email.sent',
    counterparty: 'alice@example.com',
    subjectHint: 'Quarterly numbers',
    claimedAt: '2026-10-01T10:14:00-04:00',
    claimedAtPrecision: 'minute',
    observedAt: '2026-10-01T10:30:00-04:00',
    sourceKind: 'activity_view',
    extractor: { id: 'muse.activity', version: '1.0.0', confidence: 0.9 },
    rawHash,
    ...overrides,
  };
}

export function makeRequest(overrides: Partial<RequestInput> = {}): RequestInput {
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

export function makeReceipt(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    id: ulid(301),
    agent: 'muse',
    claimId: claimId(101),
    observationIds: [observationId(1)],
    requestId: ulid(201),
    grade: 'VERIFIED',
    confidence: 0.92,
    ruleId: 'verified',
    reasons: [{ code: 'match.best', params: { observationId: observationId(1) } }],
    signals: { timeProximity: 0.9, counterpartyExact: 1 },
    state: 'PENDING',
    policyHash: sha(302),
    inputsHash: sha(301),
    computedAt: '2026-10-01T10:31:00-04:00',
    ...overrides,
  };
}

export function makeGrant(overrides: Partial<GrantInput> = {}): GrantInput {
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

export function makeHealth(overrides: Partial<AdapterHealthInput> = {}): AdapterHealthInput {
  return {
    adapterId: 'muse',
    version: '1.0.0',
    status: 'OK',
    reasons: [],
    checkedAt: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

export function makePing(overrides: Partial<CoveragePingInput> = {}): CoveragePingInput {
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
