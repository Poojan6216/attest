/**
 * Typed errors raised by the ledger layer.
 *
 * Messages and context never carry user content (Hard Rule 10): context holds table names, codes,
 * counts and Zod issue *paths* (field names), never field values.
 */
import type { z } from 'zod';

export const LEDGER_ERROR_CODES = [
  /** A write or query argument failed its Zod schema. */
  'invalid_input',
  /**
   * A write reused an existing primary key for a different content/raw hash, or an existing content/raw hash
   * for a different fact (anything but `observedAt` differs, and for a claim also anything but its `extractor`).
   */
  'id_conflict',
  /**
   * A sighting of a stored contentHash that is earlier than the stored observation's first sighting (its
   * `sightedAt`, else its `observedAt`). The stored row is kept as it is, because a batch may already have graded
   * with it (docs/grading.md §3; Hard Rule 4). Nothing is written; the caller reports the pass DEGRADED (Hard Rule 6).
   * Never raised for a claim: its sighting grades nothing, so any re-read of a stored rawHash is a no-op (§10).
   */
  'late_sighting',
  /** `recordBatchInstant` got an instant at or before the last recorded batch's. Nothing is written. */
  'batch_out_of_order',
  /** The migration list is empty, unordered, or leaves a ledger table undeclared. */
  'invalid_migrations',
  /** IndexedDB refused to open or upgrade the database. */
  'open_failed',
  /**
   * The ledger is encrypted and locked here (sprint_6 6.5; src/crypto/middleware.ts): a sealed row was read, or a row
   * written, with no key held. The whole read or write fails, never part of it.
   */
  'locked',
  /** A sealed row did not open with its own key: a changed byte, or a value moved from another row. */
  'unreadable',
  /**
   * Rebuilding the ledger's database (./rebuild.ts; Sprint 6 close, SEC-1) copied a table short: the ledger is not
   * deleted, or the copy is kept to put back again.
   */
  'rebuild_failed',
] as const;

export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[number];

export type LedgerErrorContext = Readonly<Record<string, string | number | boolean>>;

export class LedgerError extends Error {
  override readonly name = 'LedgerError';
  readonly code: LedgerErrorCode;
  readonly context: LedgerErrorContext;

  constructor(
    code: LedgerErrorCode,
    message: string,
    context: LedgerErrorContext = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.context = context;
  }
}

/**
 * Parses a row a ledger writer is about to store: the parsed row, or `LedgerError('invalid_input')` with `message`,
 * `context` and the paths at fault (field names, never a value), never a raw ZodError (sprint_4 close, tech review
 * TECH-11). A writer that calls it before it writes writes nothing when it throws.
 */
export function parseWrite<S extends z.ZodType>(
  schema: S,
  input: unknown,
  message: string,
  context: LedgerErrorContext = {},
): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)');
  throw new LedgerError('invalid_input', message, { ...context, paths: paths.join('|') });
}

/** Whether `error` is the ledger's `locked` (sprint_6 6.5): encrypted, and no key held here. */
export const isLedgerLocked = (error: unknown): boolean =>
  error instanceof LedgerError && error.code === 'locked';
