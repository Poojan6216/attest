/**
 * Typed errors raised by the ledger layer.
 *
 * Messages and context never carry user content (Hard Rule 10): context holds table names, codes,
 * counts and Zod issue *paths* (field names), never field values.
 */

export type LedgerErrorCode =
  /** A write or query argument failed its Zod schema. */
  | 'invalid_input'
  /** A write reused an existing primary key for a different content/raw hash. */
  | 'id_conflict'
  /** The migration list is empty, unordered, or leaves a ledger table undeclared. */
  | 'invalid_migrations'
  /** IndexedDB refused to open or upgrade the database. */
  | 'open_failed';

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
